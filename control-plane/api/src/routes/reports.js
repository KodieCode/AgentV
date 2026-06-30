// Reports — human-facing briefings (daily digest, weekly self-reviews, team
// reviews) persisted by the generation skills. Powers the dashboard "Briefings"
// view. The list endpoint returns metadata only (no body_md) so it stays light;
// the detail endpoint returns the full markdown body.
const express = require('express');
const db = require('../db');
const { jwtAuth } = require('../middleware/jwtAuth');

const router = express.Router();
router.use(jwtAuth);

// GET /v1/reports — newest first. Optional ?kind= and ?agent= filters,
// ?limit= (default 50, max 200).
router.get('/', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 200);
  const q = db('reports')
    .select('id', 'kind', 'agent_slug', 'title', 'meta', 'created_at')
    .orderBy('created_at', 'desc')
    .limit(limit);
  if (req.query.kind) q.where('kind', req.query.kind);
  if (req.query.agent) q.where('agent_slug', req.query.agent);
  const reports = await q;
  res.json({ reports });
});

// GET /v1/reports/:id — full report including the markdown body.
router.get('/:id', async (req, res) => {
  const report = await db('reports').where({ id: req.params.id }).first();
  if (!report) return res.status(404).json({ error: 'not_found' });
  res.json({ report });
});

module.exports = router;
