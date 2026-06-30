import { useEffect, useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../lib/api.js';

// Briefings — the human-facing surface for digests + reviews. Generation
// skills persist markdown into the control-plane `reports` table; this view
// lists them (filtered by kind) and renders the selected report's body. This
// is how digests/reviews reach the operator when email isn't wired.

const KIND_FILTERS = [
  { key: '', label: 'All' },
  { key: 'digest', label: 'Daily digest' },
  { key: 'weekly_review', label: 'Weekly review' },
  { key: 'team_review', label: 'Team review' },
];

const KIND_LABEL = {
  digest: 'Digest',
  weekly_review: 'Weekly review',
  team_review: 'Team review',
};

function relTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function Briefings() {
  const [kind, setKind] = useState('');
  const [reports, setReports] = useState([]);
  const [selected, setSelected] = useState(null); // list-row stub
  const [detail, setDetail] = useState(null);      // full report (with body_md)
  const [err, setErr] = useState(null);
  const [loaded, setLoaded] = useState(false);

  const loadList = useCallback(async () => {
    setLoaded(false);
    try {
      const r = await api.reportsList(kind ? { kind } : {});
      const rows = r.reports || [];
      setReports(rows);
      setErr(null);
      // Keep selection if still present, else pick the newest.
      setSelected((prev) => {
        if (prev && rows.some((x) => x.id === prev.id)) return prev;
        return rows[0] || null;
      });
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoaded(true);
    }
  }, [kind]);

  useEffect(() => { loadList(); }, [loadList]);

  // Fetch the full body for the selected report. List rows may omit body_md
  // for payload size, so always resolve the detail endpoint.
  useEffect(() => {
    if (!selected) { setDetail(null); return; }
    let alive = true;
    // If the list row already carries the body, use it immediately.
    if (selected.body_md != null) {
      setDetail(selected);
    } else {
      setDetail(null);
      api.reportGet(selected.id)
        .then((r) => { if (alive) setDetail(r?.report || r); })
        .catch((e) => { if (alive) setErr(e.message); });
    }
    return () => { alive = false; };
  }, [selected]);

  return (
    <div className="docs-shell">
      {/* List column */}
      <aside className="docs-files">
        <div className="docs-files-header">
          <h2 className="section-title" style={{ margin: 0 }}>Briefings</h2>
          <span className="muted small">{reports.length}</span>
        </div>

        <div className="docs-agent-picker">
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {KIND_FILTERS.map((f) => (
              <option key={f.key} value={f.key}>{f.label}</option>
            ))}
          </select>
        </div>

        <div className="docs-file-cards">
          {!loaded && <p className="muted small" style={{ padding: 12 }}>Loading…</p>}
          {loaded && reports.length === 0 && (
            <p className="muted small" style={{ padding: 12 }}>No briefings yet.</p>
          )}
          {reports.map((r) => {
            const active = selected?.id === r.id;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => setSelected(r)}
                className={'docs-file-card' + (active ? ' active' : '')}
                title={r.title}
              >
                <div className="docs-file-card-name">{r.title}</div>
                <div className="docs-file-card-meta">
                  <span className="docs-file-card-cat">{KIND_LABEL[r.kind] || r.kind}</span>
                  {r.agent_slug && <span className="muted">{r.agent_slug}</span>}
                  <span className="muted">{relTime(r.created_at)}</span>
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      {/* Viewer */}
      <section className="docs-viewer">
        {err && <div className="error-banner" style={{ margin: 16 }}>{err}</div>}
        {!selected && !err && (
          <div className="docs-viewer-empty">
            <p className="muted">Select a briefing from the left.</p>
          </div>
        )}
        {selected && !detail && !err && <p className="muted" style={{ padding: 24 }}>Loading…</p>}
        {detail && (
          <div className="docs-viewer-content">
            <div className="docs-viewer-header">
              <div>
                <h1 className="h1" style={{ margin: '0 0 4px' }}>{detail.title}</h1>
                <div className="muted small">
                  <span className="docs-file-card-cat">{KIND_LABEL[detail.kind] || detail.kind}</span>
                  {detail.agent_slug && <> · {detail.agent_slug}</>}
                  {detail.created_at && <> · {relTime(detail.created_at)}</>}
                </div>
              </div>
            </div>
            <div className="doc-body">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{detail.body_md || ''}</ReactMarkdown>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
