import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import AgentIcon from '../components/AgentIcon.jsx';

// Fleet roster + live pulse. Cards link to the per-agent dashboard.
// Pulse (busy|idle|dead) polled on a fast cadence; roster on a slow one.
export default function Roster() {
  const [agents, setAgents] = useState([]);
  const [pulse, setPulse] = useState({});
  const [err, setErr] = useState(null);
  const [loaded, setLoaded] = useState(false);

  const loadAgents = useCallback(async () => {
    try {
      const r = await api.agentsList();
      setAgents(r.agents || []);
      setErr(null);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoaded(true);
    }
  }, []);

  const loadPulse = useCallback(async () => {
    try {
      const r = await api.agentsPulse();
      setPulse(r.pulse || {});
    } catch { /* silent — pulse is best-effort */ }
  }, []);

  useEffect(() => {
    loadAgents();
    loadPulse();
    const a = setInterval(loadAgents, 15000);
    const p = setInterval(loadPulse, 4000);
    return () => { clearInterval(a); clearInterval(p); };
  }, [loadAgents, loadPulse]);

  return (
    <div className="page">
      <p className="kicker">Fleet status</p>
      <h1 className="h1">Roster</h1>
      {err && <div className="error-banner">{err}</div>}
      {loaded && agents.length === 0 && !err && (
        <p className="muted">No agents registered yet.</p>
      )}

      <div className="team-grid">
        {agents.map((a) => {
          const state = pulse[a.slug]; // 'busy' | 'idle' | 'dead' | undefined
          const isBusy = state === 'busy';
          const isDead = state === 'dead';
          const dotClass = isBusy ? 'live' : isDead ? 'failed' : 'idle';
          const statusText = isBusy ? 'Working' : isDead ? 'Offline (session not running)' : 'Idle';
          return (
            <Link
              to={`/agent/${a.slug}`}
              key={a.id || a.slug}
              className={'team-card' + (isBusy ? ' is-working' : '') + (a.active === false ? ' is-inactive' : '')}
              style={{ textDecoration: 'none', color: 'inherit' }}
            >
              <div className="team-avatar-wrap">
                <div className="team-avatar team-avatar-placeholder" style={{ padding: 18 }}>
                  <AgentIcon slug={a.slug} size={64} />
                </div>
                {isBusy && <span className="team-working-dot" />}
              </div>
              <div className="team-body">
                <div className="team-name-row">
                  <h2 className="team-name">{a.name || a.slug}</h2>
                  <span className="team-slug">{a.slug}</span>
                </div>
                {a.description && <p className="team-description">{a.description}</p>}
                <div className="team-status">
                  <span className={'team-status-dot ' + dotClass} />
                  <span className="team-status-text">{statusText}</span>
                </div>
                <div className="team-meta">
                  {a.model && <span className="team-tag">{a.model}</span>}
                  {a.active === false && <span className="team-tag team-tag-warn">inactive</span>}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
