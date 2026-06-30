// AgentV control-plane API entrypoint. All config comes from the repo-root .env
// (loaded here, override:true so .env wins over ambient shell vars). NOTHING is
// hardcoded to a deployment — port, secret, CORS, DB all come from .env.
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env'), override: true });

const express = require('express');
const cors = require('cors');
const db = require('./db');

const authRouter = require('./routes/auth');
const agentsRouter = require('./routes/agents');
const workflowsRouter = require('./routes/workflows');
const schedulesRouter = require('./routes/schedules');
const projectsRouter = require('./routes/projects');
const ideasRouter = require('./routes/ideas');
const runsRouter = require('./routes/runs');
const reportsRouter = require('./routes/reports');
const { startScheduler } = require('./lib/scheduler');

// .env-less default — the API still boots (e.g. for a healthz probe) if SERVER_PORT
// is unset, just on the conventional 8100.
const PORT = parseInt(process.env.SERVER_PORT || '8100', 10);

const app = express();

// CORS_ORIGINS accepts literal origins (https://foo.example.com) and wildcard
// patterns (https://*.example.com). Each comma-separated entry compiles to a
// string match or a regex; the origin callback checks them all. Empty allowlist
// = allow all (handy for local dev).
const corsPatterns = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((p) => {
    if (p.includes('*')) {
      const escaped = p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^.]+');
      return new RegExp('^' + escaped + '$');
    }
    return p;
  });

function corsCheck(origin, cb) {
  if (!origin) return cb(null, true); // non-browser (curl / server-to-server)
  if (!corsPatterns.length) return cb(null, true); // no allowlist — allow all
  for (const p of corsPatterns) {
    if (typeof p === 'string' && p === origin) return cb(null, true);
    if (p instanceof RegExp && p.test(origin)) return cb(null, true);
  }
  return cb(new Error('cors_origin_not_allowed: ' + origin), false);
}

app.use(cors({ origin: corsCheck, credentials: false }));
app.use(express.json({ limit: '512kb' }));

app.get('/healthz', async (_req, res) => {
  try {
    await db.raw('SELECT 1');
    res.json({ ok: true, db: 'up' });
  } catch (err) {
    console.error('healthz_db_error', err);
    res.status(503).json({ ok: false, db: 'down' });
  }
});

app.use('/v1/auth', authRouter);
app.use('/v1/agents', agentsRouter);
app.use('/v1/workflows', workflowsRouter);
app.use('/v1/schedules', schedulesRouter);
app.use('/v1/projects', projectsRouter);
app.use('/v1/ideas', ideasRouter);
app.use('/v1/runs', runsRouter);
app.use('/v1/reports', reportsRouter);

app.use((err, _req, res, _next) => {
  console.error('unhandled_error', err);
  res.status(500).json({ error: 'internal_error' });
});

const server = app.listen(PORT, () => {
  console.log(`agentv-control-plane-api listening on ${PORT}`);
  startScheduler();
});

// Mount the WebSocket terminal handler on the same HTTP server (upgrade event).
const { makeWsServer } = require('./terminal-ws');
makeWsServer(server);

function shutdown(signal) {
  console.log(`received ${signal}, shutting down`);
  server.close(() => {
    db.destroy().finally(() => process.exit(0));
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
