// Resolves repo-relative directories from .env. NOTHING is hardcoded to a
// particular box or user — AGENTS_DIR / SHARED_DIR come from .env (with sane
// repo-relative defaults) so the same code runs on any deployment.
const path = require('path');

// src/lib → src → api → control-plane → AgentV (repo root)
const ROOT = path.resolve(__dirname, '../../../..');

function resolveDir(envVal, fallback) {
  const v = envVal || fallback;
  return path.isAbsolute(v) ? v : path.resolve(ROOT, v);
}

const AGENTS_DIR = resolveDir(process.env.AGENTS_DIR, 'agents');
const SHARED_DIR = resolveDir(process.env.SHARED_DIR, 'shared');

// Convention: each agent's identity dir is <AGENTS_DIR>/<slug>.
function agentDir(slug) {
  return path.join(AGENTS_DIR, slug);
}

// Shared skill entrypoint: <SHARED_DIR>/skills/<skill>/run.sh.
function sharedSkill(skill, file = 'run.sh') {
  return path.join(SHARED_DIR, 'skills', skill, file);
}

// Base URL for the dashboard (for run links in notifications). Optional.
function dashboardUrl() {
  if (process.env.DASHBOARD_URL) return process.env.DASHBOARD_URL.replace(/\/$/, '');
  if (process.env.DASHBOARD_DOMAIN) return `https://${process.env.DASHBOARD_DOMAIN}`;
  return null;
}

module.exports = { ROOT, AGENTS_DIR, SHARED_DIR, agentDir, sharedSkill, dashboardUrl };
