# Claude Session Bridge

A read-only Cordis bundle for DeepSeek Harness that imports and browses local Claude Code and Codex sessions.

## Features

- Scans Claude Code JSONL/JSON/NDJSON and Codex session directories.
- Excludes Claude auxiliary metadata (`subagents`, `custom-title.json`, `.meta.json`, `.prefix.json`).
- Sorts sessions by their latest activity timestamp.
- Searches session names, paths, previews, and record content.
- Provides Agent tools: `session_import`, `session_list`, and `session_read`.
- Shows a searchable session list in the Harness conversation composer dock.
- Reads Claude Desktop archive state from `~/Library/Application Support/Claude/claude-code-sessions/**/local_*.json` using `cliSessionId` → JSONL filename mapping.

## Installation

Install the package directory as a local Harness bundle:

```bash
gh repo clone sena-nana/claude-session-bridge
```

Then install the cloned directory with the Harness plugin manager. The bundle is currently designed for the DeepSeek Harness desktop profile.

## Agent tools

- `session_import({ sources?, includeArchived? })`
- `session_list({ source?, query?, limit?, refresh?, includeArchived? })`
- `session_read({ id, offset?, limit? })`

Session IDs are opaque source-qualified IDs such as `claude:/absolute/path/to/session.jsonl`.

## Privacy and safety

This bundle is read-only. It reads local session files only and does not upload conversation content. Session records can contain sensitive information; review results before sharing them.

## License

MIT
