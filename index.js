import { homedir } from 'node:os';
import { join, basename, extname } from 'node:path';
import { readdir, readFile, stat } from 'node:fs/promises';

const HOME = homedir();
const AUXILIARY_FILE = /(?:^|[\\/])subagents[\\/]|(?:custom-title|\\.(?:meta|prefix))\\.json$/i;

function isAuxiliaryPath(path) {
  return AUXILIARY_FILE.test(path);
}
const roots = {
  claude: [join(HOME, '.claude', 'projects'), join(HOME, '.claude', 'sessions'), join(HOME, '.claude', 'backups')],
  codex: [join(HOME, '.codex', 'sessions'), join(HOME, '.codex', 'history')],
};
const claudeDesktopSessionsRoot = join(HOME, 'Library', 'Application Support', 'Claude', 'claude-code-sessions');
let cache = [];

async function readClaudeDesktopIndex() {
  const index = new Map();
  for (const path of await filesUnder(claudeDesktopSessionsRoot)) {
    if (extname(path).toLowerCase() !== '.json' || basename(path).startsWith('deleted_')) continue;
    try {
      const value = JSON.parse(await readFile(path, 'utf8'));
      if (value.cliSessionId) index.set(value.cliSessionId, value);
    } catch { /* ignore unrelated metadata */ }
  }
  return index;
}

async function filesUnder(dir, out = []) {
  try {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) await filesUnder(p, out);
      else if (/\.(jsonl?|ndjson)$/i.test(entry.name)) out.push(p);
    }
  } catch { /* missing optional source */ }
  return out;
}
function textOf(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  return value.text || value.content || value.message?.content || value.message || value.input || '';
}
function normalizeRecord(record) {
  const message = record.message ?? record;
  const role = record.role || message.role || record.type || 'record';
  const content = textOf(message.content ?? message.text ?? record.content ?? record.text);
  const timestamp = record.timestamp || record.created_at || record.createdAt || null;
  return { role, content: typeof content === 'string' ? content : JSON.stringify(content), timestamp };
}
async function readSessionFile(path, source, desktopIndex) {
  const [raw, fileStat] = await Promise.all([readFile(path, 'utf8'), stat(path)]);
  const records = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { records.push(normalizeRecord(JSON.parse(line))); } catch { /* tolerate non-json lines */ }
  }
  if (!records.some(record => record.content.trim())) return null;
  const timestamps = records.map(record => record.timestamp).filter(Boolean).sort();
  const updatedAt = timestamps.at(-1) || fileStat.mtime.toISOString();
  const sessionId = basename(path, extname(path));
  const desktop = source === 'claude' ? desktopIndex.get(sessionId) : undefined;
  return {
    id: `${source}:${path}`,
    source,
    name: desktop?.title || basename(path),
    path,
    archived: desktop?.isArchived === true,
    archiveSource: desktop ? 'claude-desktop' : 'none',
    updatedAt: desktop?.lastActivityAt ? new Date(desktop.lastActivityAt).toISOString() : updatedAt,
    records,
    preview: records.find(r => r.content)?.content?.slice(0, 180) || '',
    size: raw.length,
    _sortTime: Date.parse(updatedAt) || fileStat.mtimeMs,
  };
}
async function importSessions(sources = ['claude', 'codex']) {
  const desktopIndex = await readClaudeDesktopIndex();
  const paths = [];
  for (const source of sources) for (const root of roots[source] || []) {
    for (const path of await filesUnder(root)) {
      if (!isAuxiliaryPath(path)) paths.push({ path, source });
    }
  }
  const sessions = [];
  for (const item of paths) {
    try {
      const session = await readSessionFile(item.path, item.source, desktopIndex);
      if (session) sessions.push(session);
    } catch { /* skip unreadable files */ }
  }
  cache = sessions.sort((a, b) => b._sortTime - a._sortTime);
  return cache;
}
function publicSession(s) {
  return { id: s.id, source: s.source, name: s.name, path: s.path, archived: s.archived, archiveSource: s.archiveSource, updatedAt: s.updatedAt, preview: s.preview, records: s.records.length, size: s.size };
}
async function listSessions({ source, query = '', limit = 100, refresh = true, includeArchived = false } = {}) {
  if (refresh || !cache.length) await importSessions(source ? [source] : undefined);
  const q = String(query).toLowerCase();
  const max = Math.max(1, Math.min(500, Number(limit) || 100));
  return cache
    .filter(s => (!source || s.source === source) && (includeArchived || !s.archived))
    .map(s => {
      const directText = `${s.name} ${s.path} ${s.preview}`.toLowerCase();
      const contentText = s.records.map(r => r.content).join(' ').toLowerCase();
      return { session: s, directMatch: Boolean(q && directText.includes(q)), matches: !q || directText.includes(q) || contentText.includes(q) };
    })
    .filter(item => item.matches)
    .sort((a, b) => Number(b.directMatch) - Number(a.directMatch) || b.session._sortTime - a.session._sortTime)
    .slice(0, max)
    .map(item => publicSession(item.session));
}
async function readSession({ id, offset = 0, limit = 100 } = {}) {
  if (!id) throw new Error('id is required');
  let session = cache.find(s => s.id === id);
  if (!session) { await importSessions(); session = cache.find(s => s.id === id); }
  if (!session) throw new Error(`Session not found: ${id}`);
  return { ...publicSession(session), records: session.records.slice(Math.max(0, offset), Math.max(0, offset) + Math.min(1000, Math.max(1, limit))) };
}

export const host = {
  async importSessions(args = {}) {
    const sessions = await importSessions(args.sources);
    return sessions.filter(s => args.includeArchived || !s.archived).map(publicSession);
  },
  listSessions,
  readSession,
};

export function apply(ctx) {
  const tools = ctx.get('tools');
  if (!tools) return;
  const disposers = [
    tools.register({
      name: 'session_import',
      description: 'Scan local Claude Code and Codex session databases, excluding auxiliary metadata files. Archive state is read from Claude Desktop metadata when available.',
      parameters: { type: 'object', properties: { sources: { type: 'array', items: { type: 'string', enum: ['claude', 'codex'] }, description: 'Sources to scan; defaults to both.' }, includeArchived: { type: 'boolean', description: 'Include sessions marked isArchived by Claude Desktop.' } }, additionalProperties: false },
      output: { schema: { type: 'array', items: { type: 'object' } }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      async execute(input) { return host.importSessions(input || {}); },
    }),
    tools.register({
      name: 'session_list',
      description: 'List sessions newest first; by default exclude sessions marked isArchived by Claude Desktop. Query searches filename, path, preview, and record content.',
      parameters: { type: 'object', properties: { source: { type: 'string', enum: ['claude', 'codex'] }, query: { type: 'string' }, limit: { type: 'number', description: 'Maximum results, 1-500; defaults to 100.' }, refresh: { type: 'boolean', description: 'Rescan local files before listing; defaults to true.' }, includeArchived: { type: 'boolean', description: 'Include sessions marked isArchived by Claude Desktop.' } }, additionalProperties: false },
      output: { schema: { type: 'array', items: { type: 'object' } }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      async execute(input) { return listSessions(input || {}); },
    }),
    tools.register({
      name: 'session_read',
      description: 'Read records from one imported Claude Code or Codex session by id.',
      parameters: { type: 'object', required: ['id'], properties: { id: { type: 'string' }, offset: { type: 'number' }, limit: { type: 'number' } }, additionalProperties: false },
      output: { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      async execute(input) { return readSession(input || {}); },
    }),
  ];
  ctx.effect(() => () => disposers.forEach(d => d?.()), 'claude-session-bridge tools');
}
