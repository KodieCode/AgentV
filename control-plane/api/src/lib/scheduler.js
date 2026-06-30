// Cron scheduler. Ticks every 30s: self-heals any enabled schedule missing a
// next_fire_at (e.g. inserted via raw SQL), fires anything due, then recomputes
// the next fire. All times are UTC (knex timezone '+00:00').
const { CronExpressionParser } = require('cron-parser');
const db = require('./../db');
const { startRun } = require('./runner');

const TICK_MS = 30 * 1000;

async function tick() {
  const now = new Date();

  // Self-heal: enabled schedule with NULL next_fire_at gets it computed.
  const orphans = await db('schedules').where({ enabled: true }).whereNull('next_fire_at');
  for (const o of orphans) {
    try {
      const it = CronExpressionParser.parse(o.cron_expr, { currentDate: now });
      await db('schedules').where({ id: o.id }).update({ next_fire_at: it.next().toDate() });
      console.log(`scheduler: backfilled next_fire_at for ${o.id} (${o.cron_expr})`);
    } catch (err) {
      console.error(`scheduler: bad cron on orphan ${o.id}:`, err.message);
    }
  }

  const due = await db('schedules').where({ enabled: true }).andWhere('next_fire_at', '<=', now);

  for (const s of due) {
    try {
      await startRun({ workflowId: s.workflow_id, trigger: 'schedule', input: {} });
      console.log(`scheduler: fired ${s.id} (workflow ${s.workflow_id})`);
    } catch (err) {
      console.error(`scheduler: failed to fire ${s.id}:`, err.message);
    }
    let next = null;
    try {
      const it = CronExpressionParser.parse(s.cron_expr, { currentDate: now });
      next = it.next().toDate();
    } catch (err) {
      console.error(`scheduler: bad cron on ${s.id}:`, err.message);
    }
    await db('schedules').where({ id: s.id }).update({ last_fired_at: now, next_fire_at: next });
  }
}

function startScheduler() {
  setInterval(() => { tick().catch((e) => console.error('scheduler_tick_error', e)); }, TICK_MS);
  console.log(`scheduler started (tick every ${TICK_MS / 1000}s)`);
}

module.exports = { startScheduler };
