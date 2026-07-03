const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { jwtAuth, requireAdmin } = require('../middleware/jwtAuth');
const { CronExpressionParser } = require('cron-parser');

const router = express.Router();
router.use(jwtAuth);

// Compute the next fire from a cron expression. POST/PATCH always set this so a
// schedule never lands with NULL next_fire_at (which the scheduler would skip).
function computeNextFire(cron, fromDate = new Date()) {
  try {
    const it = CronExpressionParser.parse(cron, { currentDate: fromDate });
    return it.next().toDate();
  } catch {
    return null;
  }
}

router.get('/', async (_req, res) => {
  const rows = await db('schedules')
    .leftJoin('workflows', 'schedules.workflow_id', 'workflows.id')
    .leftJoin('agents', 'workflows.agent_id', 'agents.id')
    .select(
      'schedules.*',
      'workflows.name as workflow_name',
      'workflows.slug as workflow_slug',
      'agents.name as agent_name',
      'agents.slug as agent_slug',
    )
    .orderBy('schedules.created_at', 'asc');
  res.json({ schedules: rows });
});

router.post('/', requireAdmin, async (req, res) => {
  const { workflow_id, cron_expr, enabled = true } = req.body || {};
  if (!workflow_id || !cron_expr) return res.status(400).json({ error: 'missing_fields' });
  const next = computeNextFire(cron_expr);
  if (!next) return res.status(400).json({ error: 'invalid_cron' });
  const id = crypto.randomUUID();
  await db('schedules').insert({ id, workflow_id, cron_expr, enabled, next_fire_at: next });
  const row = await db('schedules').where({ id }).first();
  res.json({ schedule: row });
});

router.patch('/:id', requireAdmin, async (req, res) => {
  const allowed = ['cron_expr', 'enabled'];
  const patch = {};
  for (const k of allowed) if (k in (req.body || {})) patch[k] = req.body[k];
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'nothing_to_update' });
  if (patch.cron_expr) {
    const next = computeNextFire(patch.cron_expr);
    if (!next) return res.status(400).json({ error: 'invalid_cron' });
    patch.next_fire_at = next;
  }
  const n = await db('schedules').where({ id: req.params.id }).update(patch);
  if (!n) return res.status(404).json({ error: 'not_found' });
  const row = await db('schedules').where({ id: req.params.id }).first();
  res.json({ schedule: row });
});

router.delete('/:id', requireAdmin, async (req, res) => {
  const n = await db('schedules').where({ id: req.params.id }).del();
  if (!n) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

module.exports = router;
