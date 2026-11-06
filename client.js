window.__ModuleLoader__.load({
  id: '@local/claude-session-bridge',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    function SessionList() {
      const [items, setItems] = React.useState([]);
      const [query, setQuery] = React.useState('');
      const [selected, setSelected] = React.useState(null);
      React.useEffect(() => { host.call('listSessions', { refresh: true, limit: 30 }).then(setItems).catch(() => {}); }, []);
      const refresh = () => host.call('listSessions', { query, refresh: true, limit: 30 }).then(setItems).catch(() => {});
      return h('section', { style: { padding: '10px 12px', border: '1px solid var(--dsw-alias-border-color, #ddd)', borderRadius: 10, margin: '8px 0', background: 'var(--dsw-alias-background-secondary, transparent)' } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 } },
          h('strong', null, 'Imported sessions'),
          h('button', { onClick: refresh, style: { marginLeft: 'auto' } }, 'Refresh')),
        h('input', { value: query, onChange: e => setQuery(e.target.value), onKeyDown: e => e.key === 'Enter' && refresh(), placeholder: 'Search Claude or Codex', style: { width: '100%', boxSizing: 'border-box', marginBottom: 8 } }),
        items.length ? items.map(item => h('button', { key: item.id, onClick: () => setSelected(selected === item.id ? null : item.id), style: { display: 'block', width: '100%', textAlign: 'left', padding: '7px 4px', border: 0, background: 'transparent', cursor: 'pointer' } },
          h('div', null, `${item.source === 'claude' ? 'Claude' : 'Codex'} · ${item.name}`),
          h('small', { style: { opacity: .7 } }, `${item.updatedAt ? new Date(item.updatedAt).toLocaleString() : 'Unknown time'} · ${item.records} records`),
          h('div', { style: { opacity: .7, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, item.preview || item.path),
          selected === item.id && h('div', { style: { whiteSpace: 'pre-wrap', marginTop: 6, opacity: .85 } }, item.path))) : h('small', null, 'No sessions found.'));
    }
    return { inject: ['slots'], apply(ctx) { ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({ name: 'conversation.composer.dock', id: 'claude-session-bridge', order: 20, label: 'Imported sessions' }, SessionList)); } };
  },
});
