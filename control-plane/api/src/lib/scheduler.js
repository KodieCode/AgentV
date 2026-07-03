// Cron scheduler. Ticks every 30s: self-heals any enabled schedule missing a
// next_fire_at (e.g. inserted via raw SQL), fires anything due, then recomputes
// the next fire. All times are UTC (knex timezone '+00:00').
//
// Also owns the stranded-run reaper: runs execute in-process (runner.js), so an
// API restart mid-run leaves the row at 'running' forever — and any idea that
// run was building strands at 'building'. The reaper reconciles both on startup
// and hourly.
const { CronExpressionParser } = require('cron-parser');
const db = require('./../db');
const { startRun } = require('./runner');

const TICK_MS = 30 * 1000;
const REAP_SWEEP_MS = 60 * 60 * 1000; // hourly
// Anything 'running'/'pending' older than this is presumed orphaned. The longest
// legitimate builtin (build-idea) times out at 20 min, so 2h is generous.
const REAP_AFTER_MS = parseInt(process.env.RUN_REAP_AFTER_MINUTES || '120', 10) * 60 * 1000;

async function reapStrandedRuns() {
  const cutoff = new Date(Date.now() - REAP_AFTER_MS);

  // 1. Runs stuck in-flight past the threshold → failed/orphaned.
  const stranded = await db('runs')
    .whereIn('status', ['running', 'pending'])
    .where('created_at', '<', cutoff)
    .select('id');
  if (stranded.length) {
    await db('runs')
      .whereIn('id', stranded.map((r) => r.id))
      .update({ status: 'failed', finished_at: new Date(), error: 'orphaned_by_restart' });
    console.warn(`scheduler: reaped ${stranded.length} stranded run(s) → failed (orphaned_by_restart)`);
  }

  // 2. Ideas stuck at 'building' whose build run died (reaped above, failed,
  //    cancelled, or missing entirely) → build_failed with a visible reason,
  //    so nothing strands invisibly on the kanban.
  const building = await db('ideas').where({ status: 'building' });
  for (const idea of building) {
    let orphaned = false;
    if (!idea.build_run_id) {
      // No run recorded — only reap once it's clearly stale.
      const since = idea.decided_at || idea.created_at;
      orphaned = since && new Date(since) < cutoff;
    } else {
      const run = await db('runs').where({ id: idea.build_run_id }).first();
      orphaned = !run || ['failed', 'cancelled'].includes(run.status);
    }
    if (orphaned) {
      await db('ideas').where({ id: idea.id }).update({
        status: 'build_failed',
        decision_reason: 'build run orphaned (API restart or crash mid-build) — re-approve to retry',
      });
      console.warn(`scheduler: idea ${idea.id} building → build_failed (orphaned build run)`);
    }
  }
}

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
  // Reap immediately on startup (catches runs orphaned by the restart that just
  // happened), then sweep hourly.
  reapStrandedRuns().catch((e) => console.error('scheduler_reap_error', e));
  setInterval(() => { reapStrandedRuns().catch((e) => console.error('scheduler_reap_error', e)); }, REAP_SWEEP_MS);
  console.log(`scheduler started (tick every ${TICK_MS / 1000}s, stranded-run sweep hourly, reap after ${REAP_AFTER_MS / 60000}m)`);
}

module.exports = { startScheduler, reapStrandedRuns };
