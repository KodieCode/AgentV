import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import AgentIcon from '../components/AgentIcon.jsx';
import AgentTerminal from '../components/AgentTerminal.jsx';

// Per-agent view: an overview header (identity + live pulse) and a live
// terminal tab attached to the agent's tmux session. Built from the roster
// list + pulse so it depends only on the confirmed control-plane endpoints.
export default function AgentDashboard() {
  const { slug } = useParams();
  const [agent, setAgent] = useState(null);
  const [err, setErr] = useState(null);
  const [tab, setTab] = useState('overview');
  const [pulseState, setPulseState] = useState(null); // 'busy' | 'idle' | 'dead'

  const load = useCallback(async () => {
    setErr(null);
    try {
      // Prefer a dedicated endpoint if present; fall back to the roster list.
      let found = null;
      try {
        const r = await api.agentGet(slug);
        found = r?.agent || r || null;
      } catch {
        const list = await api.agentsList();
        found = (list.agents || []).find((a) => a.slug === slug) || null;
      }
      if (!found) throw new Error(`No agent "${slug}"`);
      setAgent(found);
    } catch (e) {
      setErr(e.message);
      setAgent(null);
    }
  }, [slug]);

  useEffect(() => {
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    const refresh = async () => {
      try {
        const r = await api.agentsPulse();
        setPulseState(r.pulse?.[slug] || null);
      } catch { /* silent */ }
    };
    refresh();
    const id = setInterval(refresh, 4000);
    return () => clearInterval(id);
  }, [slug]);

  if (err) return (
    <div className="page">
      <Link to="/roster" className="back-link">← Roster</Link>
      <div className="error-banner">{err}</div>
    </div>
  );
  if (!agent) return <div className="page"><p className="muted">Loading…</p></div>;

  return (
    <div className="page">
      <Link to="/roster" className="back-link">← Roster</Link>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
        <div style={{ background: 'var(--panel-2)', padding: 12, borderRadius: 'var(--radius)' }}>
          <AgentIcon slug={agent.slug} size={56} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 className="h1" style={{ margin: 0 }}>{agent.name || agent.slug}</h1>
            {pulseState && (
              <span
                title={pulseState === 'busy' ? 'working' : pulseState === 'dead' ? 'session not running' : 'idle'}
                style={{
                  width: 9, height: 9, borderRadius: 999,
                  background: pulseState === 'busy' ? '#22c55e' : pulseState === 'dead' ? 'var(--border)' : 'var(--muted)',
                  opacity: pulseState === 'busy' ? 1 : 0.55,
                  animation: pulseState === 'busy' ? 'busy-pulse 1.4s ease-in-out infinite' : 'none',
                }}
              />
            )}
            <span className="muted small">
              {pulseState === 'busy' ? 'Working' : pulseState === 'dead' ? 'Offline' : 'Idle'}
            </span>
          </div>
          <p className="muted small" style={{ margin: 0 }}>
            {agent.slug}{agent.model ? ` · ${agent.model}` : ''}
          </p>
          {agent.description && (
            <p className="muted small" style={{ margin: '4px 0 0', maxWidth: 600, overflowWrap: 'anywhere' }}>
              {agent.description}
            </p>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid var(--border)' }}>
        {['overview', 'terminal'].map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            style={{
              background: 'transparent',
              border: 'none',
              borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
              color: tab === t ? 'var(--fg)' : 'var(--muted)',
              padding: '8px 14px',
              fontSize: 13,
              cursor: 'pointer',
              textTransform: 'capitalize',
            }}
          >{t}</button>
        ))}
      </div>

      {tab === 'terminal' && (
        <div style={{ height: 'calc(100vh - 280px)', minHeight: 400, border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
          <AgentTerminal slug={agent.slug} />
        </div>
      )}

      {tab === 'overview' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(260px, 100%), 1fr))', gap: 16 }}>
          <div className="card">
            <h2 className="section-title">Identity</h2>
            <div className="meta-grid" style={{ marginTop: 0, borderTop: 'none', paddingTop: 0 }}>
              <div className="meta-cell">
                <div className="meta-label">Slug</div>
                <div className="meta-value">{agent.slug}</div>
              </div>
              {agent.model && (
                <div className="meta-cell">
                  <div className="meta-label">Model</div>
                  <div className="meta-value">{agent.model}</div>
                </div>
              )}
              <div className="meta-cell">
                <div className="meta-label">Status</div>
                <div className="meta-value">{agent.active === false ? 'inactive' : 'active'}</div>
              </div>
              {agent.tmux_session && (
                <div className="meta-cell">
                  <div className="meta-label">Session</div>
                  <div className="meta-value">{agent.tmux_session}</div>
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <h2 className="section-title">Live session</h2>
            <p className="muted small" style={{ marginTop: 0 }}>
              Open the <button type="button" className="btn-link" style={{ display: 'inline', padding: 0 }} onClick={() => setTab('terminal')}>Terminal</button> tab
              to attach to this agent's tmux session in real time.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
