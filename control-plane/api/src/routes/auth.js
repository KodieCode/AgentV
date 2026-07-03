const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { jwtAuth } = require('../middleware/jwtAuth');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'missing_credentials' });

  const user = await db('users').where({ username }).first();
  // Same response for unknown user vs wrong password — don't leak usernames.
  const fail = () => res.status(401).json({ error: 'invalid_credentials' });

  if (!user) return fail();
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return fail();

  await db('users').where({ id: user.id }).update({ last_login_at: new Date() });

  // Dashboard logins are operator/human sessions — full access.
  const token = jwt.sign(
    { sub: user.id, username: user.username, role: 'admin' },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' },
  );
  res.json({ token, user: { id: user.id, username: user.username } });
});

router.get('/me', jwtAuth, async (req, res) => {
  const u = await db('users').where({ id: req.auth_user.id }).first();
  if (!u) return res.status(401).json({ error: 'user_gone' });
  res.json({ user: { id: u.id, username: u.username } });
});

module.exports = router;
