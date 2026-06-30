import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

// Kanban lanes mirror the ideas.status enum in the control-plane schema.
const LANES = [
  { key: 'new', label: 'New' },
  { key: 'approved', label: 'Approved' },
  { key: 'building', label: 'Building' },
  { key: 'build_failed', label: 'Build failed' },
  { key: 'pr_open', label: 'PR open' },
  { key: 'done', label: 'Done' },
  { key: 'rejected', label: 'Rejected' },
];

// Allowed manual transitions. Approving fires the build workflow server-side;
// building -> pr_open / build_failed is set by the builder itself.
const NEXT_FROM = {
  new: ['approved', 'rejected'],
  approved: ['rejected'],
  building: ['pr_open', 'build_failed', 'rejected'],
  build_failed: ['approved', 'rejected'],
  pr_open: ['done', 'rejected'],
  done: [],
  rejected: [],
};

export default function Ideas() {
  const [ideas, setIdeas] = useState([]);
  const [err, setErr] = useState(null);
  const [open, setOpen] = useState(null);

  const load = async () => {
    try { setIdeas((await api.ideasList()).ideas || []); }
    catch (e) { setErr(e.message); }
  };
  useEffect(() => { load(); }, []);

  const transition = async (idea, newStatus) => {
    let reason;
    if (newStatus === 'rejected') {
      reason = prompt('Reason for rejection? (optional)');
      if (reason === null) return; // cancelled
    }
    try {
      await api.ideaStatus(idea.id, { status: newStatus, decision_reason: reason || undefined });
      await load();
      if (open?.id === idea.id) setOpen(null);
    } catch (e) { setErr(e.message); }
  };

  const lanes = LANES.map((l) => ({ ...l, items: ideas.filter((i) => i.status === l.key) }));

  return (
    <div className="page">
      <p className="kicker">Agent-proposed improvements</p>
      <h1 className="h1">Ideas</h1>
      {err && <div className="error-banner">{err}</div>}

      <div className="kanban">
        {lanes.map((lane) => (
          <div key={lane.key} className="kanban-lane">
            <div className="kanban-lane-header">
              <span>{lane.label}</span>
              <span className="kanban-count">{lane.items.length}</span>
            </div>
            <div className="kanban-cards">
              {lane.items.map((idea) => (
                <div className="kanban-card" key={idea.id} onClick={() => setOpen(idea)}>
                  <div className="kanban-card-title">{idea.title}</div>
                  <div className="kanban-card-meta">
                    {[idea.agent_slug, idea.project_slug].filter(Boolean).join(' · ') || '—'}
                  </div>
                  {(idea.impact_score != null || idea.effort_score != null) && (
                    <div className="kanban-card-scores">
                      i:{idea.impact_score ?? '?'}/10 · e:{idea.effort_score ?? '?'}/10
                    </div>
                  )}
                </div>
              ))}
              {!lane.items.length && <div className="kanban-empty">—</div>}
            </div>
          </div>
        ))}
      </div>

      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <p className="kicker">{[open.agent_slug, open.project_slug].filter(Boolean).join(' / ') || 'idea'}</p>
            <h2 className="h1" style={{ fontSize: 18 }}>{open.title}</h2>
            <div className="subnum" style={{ marginBottom: 12 }}>
              status: <span className={'status-pill ' + open.status}>{open.status}</span>
              {open.impact_score != null && <> · impact <strong>{open.impact_score}/10</strong></>}
              {open.effort_score != null && <> · effort <strong>{open.effort_score}/10</strong></>}
            </div>
            {open.body && <pre className="code-block">{open.body}</pre>}
            {open.spec_path && <p className="muted small">spec: <code>{open.spec_path}</code></p>}
            {open.pr_url && <p className="muted small">PR: <a href={open.pr_url} target="_blank" rel="noreferrer">{open.pr_url}</a></p>}
            {open.decision_reason && (
              <p className="muted small">last decision reason: <em>{open.decision_reason}</em></p>
            )}

            <div className="row" style={{ marginTop: 16, justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
              <button className="pill-ghost" onClick={() => setOpen(null)}>Close</button>
              {NEXT_FROM[open.status]?.map((next) => (
                <button
                  key={next}
                  className={next === 'rejected' ? 'pill-ghost danger' : 'pill'}
                  onClick={() => transition(open, next)}
                >
                  → {next}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
