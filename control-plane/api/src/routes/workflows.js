const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { jwtAuth, requireAdmin } = require('../middleware/jwtAuth');
const { startRun } = require('../lib/runner');
const { builtins } = require('../lib/builtins');

const router = express.Router();

// List the builtins available to attach to a workflow.
router.get('/builtins', jwtAuth, (_req, res) => {
  res.json({
    builtins: Object.entries(builtins).map(([id, b]) => ({
      id,
      label: b.label,
      description: b.description,
    })),
  });
});

router.get('/', jwtAuth, async (_req, res) => {
  const rows = await db('workflows')
    .leftJoin('agents', 'workflows.agent_id', 'agents.id')
    .select('workflows.*', 'agents.slug as agent_slug', 'agents.name as agent_name')
    .orderBy('workflows.created_at', 'asc');
  res.json({ workflows: rows });
});

router.get('/:id', jwtAuth, async (req, res) => {
  const row = await db('workflows')
    .leftJoin('agents', 'workflows.agent_id', 'agents.id')
    .select('workflows.*', 'agents.slug as agent_slug', 'agents.name as agent_name')
    .where('workflows.id', req.params.id)
    .first();
  if (!row) return res.status(404).json({ error: 'not_found' });
  res.json({ workflow: row });
});

router.post('/', jwtAuth, requireAdmin, async (req, res) => {
  const { agent_id, slug, name, description, kind = 'manual', builtin_id, config } = req.body || {};
  if (!agent_id || !slug || !name) return res.status(400).json({ error: 'missing_fields' });
  if (kind === 'builtin' && !builtin_id) return res.status(400).json({ error: 'builtin_id_required' });
  const id = crypto.randomUUID();
  await db('workflows').insert({
    id, agent_id, slug, name, description, kind, builtin_id,
    config: config ? JSON.stringify(config) : null,
  });
  const row = await db('workflows').where({ id }).first();
  res.json({ workflow: row });
});

router.patch('/:id', jwtAuth, requireAdmin, async (req, res) => {
  const allowed = ['name', 'description', 'kind', 'builtin_id', 'config', 'active'];
  const patch = {};
  for (const k of allowed) {
    if (k in (req.body || {})) patch[k] = k === 'config' ? JSON.stringify(req.body[k]) : req.body[k];
  }
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'nothing_to_update' });
  patch.updated_at = new Date();
  const n = await db('workflows').where({ id: req.params.id }).update(patch);
  if (!n) return res.status(404).json({ error: 'not_found' });
  const row = await db('workflows').where({ id: req.params.id }).first();
  res.json({ workflow: row });
});

router.delete('/:id', jwtAuth, requireAdmin, async (req, res) => {
  const n = await db('workflows').where({ id: req.params.id }).del();
  if (!n) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

// Admin-only: firing a workflow executes server-side builtins (build-idea shells
// claude with repo write access) — an agent must not be able to trigger arbitrary
// workflows with arbitrary input. The scheduler + idea-approval paths call
// startRun() in-process and are unaffected.
router.post('/:id/run', jwtAuth, requireAdmin, async (req, res) => {
  try {
    const runId = await startRun({ workflowId: req.params.id, trigger: 'manual', input: req.body?.input || {} });
    res.json({ runId });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/:id/runs', jwtAuth, async (req, res) => {
  const rows = await db('runs').where({ workflow_id: req.params.id }).orderBy('created_at', 'desc').limit(50);
  res.json({ runs: rows });
});

module.exports = router;
