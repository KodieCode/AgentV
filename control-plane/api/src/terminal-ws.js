// WebSocket terminal — attaches an xterm.js client to an agent's tmux session
// via node-pty + `tmux attach-session`. Bidirectional bytes. JWT-gated,
// ADMIN-ONLY: a pty on an agent session is full interactive control of that
// agent (and its credentials), so agent tokens are refused — otherwise any
// agent could drive any other agent's session.
//
//   URL: wss://<dashboard-api>/v1/agent/<slug>/terminal?token=<jwt>
//
// The JWT travels in the query string because browsers can't set an
// Authorization header on a WebSocket upgrade. Accepted trade-off: tokens can
// land in intermediary logs — keep the dashboard behind TLS and treat access
// logs as sensitive.
//
// The slug→session resolution is DB-driven (agents.tmux_session) — NOT a
// hardcoded map. Adding an agent in the DB makes its terminal work immediately;
// nothing here needs editing.
//
// Caveat: shared attach — if another client (e.g. a desktop app) is attached to
// the same session, keystrokes interleave. That's tmux's default and intentional.

const jwt = require('jsonwebtoken');
const pty = require('node-pty');
const { WebSocketServer } = require('ws');
const db = require('./db');

function makeWsServer(httpServer) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    // Path: /v1/agent/<slug>/terminal
    const m = req.url.match(/^\/v1\/agent\/([a-z0-9_-]+)\/terminal(\?|$)/i);
    if (!m) { socket.destroy(); return; }
    const slug = m[1];

    // JWT in query string (browsers can't set headers on a WS upgrade).
    const url = new URL(req.url, 'http://x');
    const token = url.searchParams.get('token');
    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    // Admin-only. Legacy role-less tokens count as agents — re-login to attach.
    if (payload.role !== 'admin') {
      console.warn(`[terminal] REFUSED non-admin attach slug=${slug} sub=${payload.sub} at ${new Date().toISOString()}`);
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    // Resolve the tmux session from the DB.
    db('agents')
      .where({ slug })
      .first('tmux_session')
      .then((row) => {
        const session = row && row.tmux_session;
        if (!session) { socket.destroy(); return; }
        wss.handleUpgrade(req, socket, head, (ws) => handleSession(ws, session, slug, payload.sub));
      })
      .catch(() => socket.destroy());
  });
}

function handleSession(ws, session, slug, sub) {
  // `tmux attach-session -t <session>` in a PTY. We deliberately DON'T pass -d,
  // so a dashboard attach coexists with any other client's attach.
  let term;
  try {
    term = pty.spawn('tmux', ['attach-session', '-t', session], {
      name: 'xterm-256color',
      cols: 100,
      rows: 30,
      cwd: process.env.HOME || process.cwd(),
      env: { ...process.env, TERM: 'xterm-256color' },
    });
  } catch (e) {
    ws.send(`\r\n[failed to spawn tmux: ${e.message}]\r\n`);
    ws.close();
    return;
  }

  console.log(`[terminal] ws attached to ${slug} (tmux session ${session}) by sub=${sub} pid=${term.pid} at ${new Date().toISOString()}`);

  term.onData((data) => {
    if (ws.readyState === 1) ws.send(data);
  });

  term.onExit(({ exitCode, signal }) => {
    console.log(`[terminal] pty exit slug=${slug} code=${exitCode} signal=${signal}`);
    if (ws.readyState === 1) {
      try { ws.send(`\r\n[tmux session exited code=${exitCode}]\r\n`); } catch { /* ws closing */ }
      ws.close();
    }
  });

  ws.on('message', (msg) => {
    let s;
    try { s = msg.toString('utf8'); } catch { return; }
    // Resize control: client sends '\x1bSZ<cols>,<rows>' as a sentinel.
    if (s.startsWith('\x1bSZ')) {
      const [c, r] = s.slice(3).split(',').map((n) => parseInt(n, 10));
      if (c > 0 && r > 0) {
        try { term.resize(c, r); } catch { /* ignore bad resize */ }
      }
      return;
    }
    try { term.write(s); } catch { /* term gone */ }
  });

  ws.on('close', () => {
    console.log(`[terminal] ws closed slug=${slug}`);
    try { term.kill(); } catch { /* already dead */ }
  });

  ws.on('error', () => {
    try { term.kill(); } catch { /* already dead */ }
  });
}

module.exports = { makeWsServer };
