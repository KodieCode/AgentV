import { useEffect, useState, useCallback } from 'react';
import { NavLink } from 'react-router-dom';
import { api } from '../lib/api.js';
import AgentIcon from './AgentIcon.jsx';

// Sidebar roster with live pulse. Built from /v1/agents (roster) +
// /v1/agents/pulse (busy|idle|dead per slug). No deployment-specific roster
// is baked in — whatever the control-plane DB returns is what renders.
export default function SidebarAgentList() {
  const [agents, setAgents] = useState([]);
  const [pulse, setPulse] = useState({});
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await api.agentsList();
      setAgents(r.agents || []);
    } catch { /* silent */ }
    finally { setLoaded(true); }
  }, []);

  const refreshPulse = useCallback(async () => {
    try {
      const r = await api.agentsPulse();
      setPulse(r.pulse || {});
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    refresh();
    refreshPulse();
    const t = setInterval(refresh, 10000);
    const p = setInterval(refreshPulse, 4000);
    return () => { clearInterval(t); clearInterval(p); };
  }, [refresh, refreshPulse]);

  if (!loaded) return null;

  return (
    <div className="sidebar-agents">
      <div className="sidebar-agents-title">Agents</div>
      <ul className="sidebar-agents-list">
        {agents.map((a) => {
          const slug = a.slug;
          const pulseState = pulse[slug]; // 'busy' | 'idle' | 'dead' | undefined
          const isBusy = pulseState === 'busy';
          const isDead = pulseState === 'dead';
          const dotClass = isBusy ? ' live' : isDead ? ' off' : a.active ? ' idle' : ' off';
          const dotTitle = isBusy ? 'working' : isDead ? 'session not running' : 'idle';
          const statusText = isBusy ? 'Working' : isDead ? 'Offline' : 'Idle';
          return (
            <li key={a.id || slug}>
              <NavLink
                to={`/agent/${slug}`}
                className={({ isActive }) => 'sidebar-agent-row' + (isActive ? ' active' : '')}
              >
                <span
                  className={'sidebar-agent-dot' + dotClass + (isBusy ? ' busy-pulse' : '')}
                  title={dotTitle}
                />
                <div className="sidebar-agent-icon">
                  <AgentIcon slug={slug} size={22} />
                </div>
                <div className="sidebar-agent-text">
                  <div className="sidebar-agent-name">{a.name || slug}</div>
                  <div className="sidebar-agent-status">{statusText}</div>
                </div>
              </NavLink>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
