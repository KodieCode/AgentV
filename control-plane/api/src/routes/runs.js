// Runs + run_logs. List recent runs, fetch a run with its logs, and stream a
// live run via Server-Sent Events. SSE accepts the JWT via query string because
// browsers can't set an Authorization header on an EventSource.
const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { jwtAuth } = require('../middleware/jwtAuth');
const { subscribe } = require('../lib/runner');

const router = express.Router();

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

// GET /v1/runs — recent runs across all workflows (newest first). Optional
// ?status= and ?workflow_id= filters; ?limit= (default 50, max 200).
router.get('/', jwtAuth, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 200);
  const q = db('runs as r')
    .leftJoin('workflows as w', 'r.workflow_id', 'w.id')
    .leftJoin('agents as a', 'w.agent_id', 'a.id')
    .select(
      'r.id', 'r.workflow_id', 'r.status', 'r.trigger', 'r.started_at', 'r.finished_at',
      'r.error', 'r.created_at',
      'w.slug as workflow_slug', 'w.name as workflow_name',
      'a.slug as agent_slug', 'a.name as agent_name',
    )
    .orderBy('r.created_at', 'desc')
    .limit(limit);
  if (req.query.status) q.where('r.status', req.query.status);
  if (req.query.workflow_id) q.where('r.workflow_id', req.query.workflow_id);
  const runs = await q;
  res.json({ runs });
});

// GET /v1/runs/:runId/stream — SSE: status + backlog logs, then live events.
router.get('/:runId/stream', async (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(401).json({ error: 'missing_token' });
  try {
    jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'invalid_token' });
  }

  const runId = req.params.runId;
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  const run = await db('runs').where({ id: runId }).first();
  if (!run) {
    res.write(`event: error\ndata: ${JSON.stringify({ error: 'run_not_found' })}\n\n`);
    return res.end();
  }

  // knex+mysql2 auto-parses JSON columns; only re-parse if a string slipped through.
  const outputObj = typeof run.output === 'string' ? (run.output ? safeParse(run.output) : null) : (run.output || null);
  res.write(
    `event: status\ndata: ${JSON.stringify({
      status: run.status, started_at: run.started_at, finished_at: run.finished_at, output: outputObj, error: run.error,
    })}\n\n`,
  );

  const oldLogs = await db('run_logs').where({ run_id: runId }).orderBy('id', 'asc');
  for (const log of oldLogs) {
    res.write(`event: log\ndata: ${JSON.stringify({ ts: log.ts, level: log.level, message: log.message })}\n\n`);
  }

  if (['succeeded', 'failed', 'cancelled'].includes(run.status)) {
    res.write('event: end\ndata: {}\n\n');
    return res.end();
  }

  const unsub = subscribe(runId, (event) => {
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    if (event.type === 'end') {
      unsub();
      res.end();
    }
  });
  req.on('close', () => unsub());
});

// GET /v1/runs/:runId — run row + its logs.
router.get('/:runId', jwtAuth, async (req, res) => {
  const run = await db('runs').where({ id: req.params.runId }).first();
  if (!run) return res.status(404).json({ error: 'not_found' });
  const logs = await db('run_logs').where({ run_id: req.params.runId }).orderBy('id', 'asc');
  res.json({ run, logs });
});

module.exports = router;
