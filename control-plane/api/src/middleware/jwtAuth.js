const jwt = require('jsonwebtoken');

// Bearer-token gate. Verifies against JWT_SECRET (.env). Populates req.auth_user
// with { id, username, role } for downstream handlers (e.g. ideas.decided_by).
//
// Roles:
//   admin — operator/human tokens: the dashboard login (routes/auth.js) and the
//           short-lived operator bootstrap token new-agent.sh signs. Full access.
//   agent — per-agent tokens: minted via POST /v1/agents/:slug/token or
//           direct-signed by new-agent.sh during bootstrap. Read access plus
//           idea submission; every route that represents a HUMAN decision
//           (token minting, roster mutation, idea approval/merge,
//           schedule/workflow mutation, terminal attach) is gated behind
//           requireAdmin.
//
// Legacy tokens carrying no role claim are treated as role 'agent' (least
// privilege). Operators holding pre-role tokens must sign in again after
// upgrading — agent tokens keep working unchanged.
function jwtAuth(req, res, next) {
  const header = req.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return res.status(401).json({ error: 'missing_token' });

  try {
    const payload = jwt.verify(match[1].trim(), process.env.JWT_SECRET);
    const role = payload.role === 'admin' ? 'admin' : 'agent';
    req.auth_user = { id: payload.sub, username: payload.username, role };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'invalid_token', detail: err.message });
  }
}

// Admin-only gate — mount AFTER jwtAuth. 403s any token whose role isn't
// 'admin' (including legacy role-less tokens, which default to 'agent').
function requireAdmin(req, res, next) {
  if (req.auth_user && req.auth_user.role === 'admin') return next();
  return res.status(403).json({ error: 'admin_required' });
}

module.exports = { jwtAuth, requireAdmin };
