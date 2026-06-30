import { getToken, clearSession } from './auth.js';

// API base is driven entirely by env — no hardcoded host. In dev this points
// at the control-plane API dev port; in prod, the public API origin.
const ENDPOINT = (import.meta.env.VITE_API_URL || 'http://localhost:8100').replace(/\/$/, '');

async function request(path, init = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(init.headers || {}),
  };
  const token = getToken();
  if (token) headers.Authorization = 'Bearer ' + token;

  const res = await fetch(ENDPOINT + path, { ...init, headers });

  if (res.status === 401 && !path.startsWith('/v1/auth/login')) {
    clearSession();
    throw new Error('unauthorized');
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  // Some endpoints (e.g. 204) return no body.
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) return null;
  return res.json();
}

export const apiBase = ENDPOINT;

export const api = {
  // --- auth ---
  login: (username, password) =>
    request('/v1/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  me: () => request('/v1/auth/me'),

  // --- agents / roster / pulse ---
  agentsList: () => request('/v1/agents'),
  agentsPulse: () => request('/v1/agents/pulse'),
  agentGet: (slug) => request(`/v1/agents/${encodeURIComponent(slug)}`),

  // --- ideas (kanban) ---
  ideasList: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request('/v1/ideas' + (qs ? '?' + qs : ''));
  },
  ideaGet: (id) => request(`/v1/ideas/${id}`),
  // Approving an idea fires the build workflow server-side.
  ideaStatus: (id, body) =>
    request(`/v1/ideas/${id}/status`, { method: 'PATCH', body: JSON.stringify(body) }),

  // --- reports / briefings ---
  // kind filter: digest | weekly_review | team_review | <custom>
  reportsList: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request('/v1/reports' + (qs ? '?' + qs : ''));
  },
  reportGet: (id) => request(`/v1/reports/${id}`),

  // --- websocket helper for the agent terminal ---
  // Returns a ws(s):// URL for the per-agent terminal endpoint.
  terminalUrl: (slug) => {
    const wsBase = ENDPOINT.replace(/^https?:/, (m) => (m === 'https:' ? 'wss:' : 'ws:'));
    return `${wsBase}/v1/agent/${encodeURIComponent(slug)}/terminal?token=${encodeURIComponent(getToken())}`;
  },
};
