import { useState, useEffect } from 'react';
import { Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import { api } from './lib/api.js';
import SidebarAgentList from './components/SidebarAgentList.jsx';
import { IconRoster, IconIdeas, IconBriefings } from './components/NavIcons.jsx';
import Login from './pages/Login.jsx';
import Roster from './pages/Roster.jsx';
import AgentDashboard from './pages/AgentDashboard.jsx';
import Ideas from './pages/Ideas.jsx';
import Briefings from './pages/Briefings.jsx';

const APP_NAME = import.meta.env.VITE_APP_NAME || 'Control Plane';

function Sidebar({ navOpen }) {
  const { user, logout } = useAuth();
  return (
    <aside className={'sidebar' + (navOpen ? ' open' : '')}>
      <div className="sidebar-brand">
        <div className="sidebar-brand-title">
          <svg className="brand-mark" width="18" height="18" viewBox="0 0 7 7" shapeRendering="crispEdges" aria-hidden="true">
            {[
              '..XXX..',
              '.XXXXX.',
              'XX.X.XX',
              'XXXXXXX',
              'XX.X.XX',
              '.XXXXX.',
              '..XXX..',
            ].flatMap((row, y) =>
              [...row].map((c, x) => c === 'X'
                ? <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="#c4ff3d" />
                : null)
            )}
          </svg>
          <span className="logo-text">
            <span className="logo-text-bold">{APP_NAME}</span>
          </span>
        </div>
      </div>

      <SidebarAgentList />

      <div className="sidebar-section-label">Views</div>
      <nav className="sidebar-nav">
        <NavLink to="/roster" className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}>
          <IconRoster /> <span>Roster</span>
        </NavLink>
        <NavLink to="/ideas" className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}>
          <IconIdeas /> <span>Ideas</span>
        </NavLink>
        <NavLink to="/briefings" className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}>
          <IconBriefings /> <span>Briefings</span>
        </NavLink>
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-user">{user?.username}</div>
        <button type="button" className="btn-link" onClick={logout}>Sign out</button>
      </div>
    </aside>
  );
}

function UpdateBanner() {
  const [info, setInfo] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let live = true;
    api.version().then((v) => { if (live) setInfo(v); }).catch(() => {});
    return () => { live = false; };
  }, []);

  if (!info?.updateAvailable) return null;
  // Dismiss is remembered per-version so a newer release re-surfaces it.
  const key = 'av.updateDismissed';
  if (!dismissed && localStorage.getItem(key) === info.latest) return null;

  return (
    <div className="update-banner" role="status">
      <span>
        <strong>AgentV {info.latest}</strong> is available
        {info.current ? ` (you're on ${info.current})` : ''} — run{' '}
        <code>git pull &amp;&amp; bash setup/update.sh</code>
      </span>
      <button
        type="button"
        className="update-banner-dismiss"
        aria-label="Dismiss"
        onClick={() => { localStorage.setItem(key, info.latest); setDismissed(true); }}
      >
        ✕
      </button>
    </div>
  );
}

function ProtectedShell() {
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();

  useEffect(() => { setNavOpen(false); }, [location.pathname]);

  useEffect(() => {
    document.body.style.overflow = navOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [navOpen]);

  return (
    <div className="app-shell">
      <Sidebar navOpen={navOpen} />
      {navOpen && (
        <div className="sidebar-backdrop" onClick={() => setNavOpen(false)} aria-hidden="true" />
      )}
      <div className="mobile-topbar">
        <button
          type="button"
          className="hamburger-btn"
          aria-label={navOpen ? 'Close navigation' : 'Open navigation'}
          aria-expanded={navOpen}
          onClick={() => setNavOpen((v) => !v)}
        >
          <span aria-hidden="true">☰</span>
        </button>
        <span className="mobile-topbar-title">{APP_NAME}</span>
      </div>
      <main className="main">
        <UpdateBanner />
        <Routes>
          <Route path="/" element={<Navigate to="/roster" replace />} />
          <Route path="/roster" element={<Roster />} />
          <Route path="/agent/:slug" element={<AgentDashboard />} />
          <Route path="/ideas" element={<Ideas />} />
          <Route path="/briefings" element={<Briefings />} />
          <Route path="*" element={<Navigate to="/roster" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <div className="loading">Loading…</div>;
  return user ? <ProtectedShell /> : <Login />;
}
