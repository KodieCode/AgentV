const jwt = require('jsonwebtoken');

// Bearer-token gate. Verifies against JWT_SECRET (.env). Populates req.auth_user
// with { id, username } for downstream handlers (e.g. ideas.decided_by).
function jwtAuth(req, res, next) {
  const header = req.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return res.status(401).json({ error: 'missing_token' });

  try {
    const payload = jwt.verify(match[1].trim(), process.env.JWT_SECRET);
    req.auth_user = { id: payload.sub, username: payload.username };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'invalid_token', detail: err.message });
  }
}

module.exports = { jwtAuth };
