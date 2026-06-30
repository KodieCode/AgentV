// Workflow runner. Executes a workflow's builtin, streams logs to subscribers
// (SSE) + persists them to run_logs, and records the run lifecycle in `runs`.
// Completion notifications are opt-in per builtin (notify_on_complete) and
// best-effort via the env-driven mail relay.
const crypto = require('crypto');
const db = require('../db');
const { builtins } = require('./builtins');
const { sendMail } = require('./notify');
const { dashboardUrl } = require('./paths');

const subs = new Map();

function subscribe(runId, handler) {
  if (!subs.has(runId)) subs.set(runId, new Set());
  subs.get(runId).add(handler);
  return () => {
    const s = subs.get(runId);
    if (s) {
      s.delete(handler);
      if (!s.size) subs.delete(runId);
    }
  };
}

function emit(runId, event) {
  const s = subs.get(runId);
  if (!s) return;
  for (const h of s) {
    try { h(event); } catch { /* a dead subscriber must not break the run */ }
  }
}

function defaultNotificationHtml({ status, workflow, output, error, runId, trigger, durationMs }) {
  const base = dashboardUrl();
  const runRef = base ? `<a href="${base}/runs/${runId}">${runId}</a>` : `<code>${runId}</code>`;
  const lines = [
    `<h2>${workflow.name}</h2>`,
    `<p><strong>Status:</strong> ${status === 'succeeded' ? 'succeeded' : 'failed'}</p>`,
    `<p><strong>Trigger:</strong> ${trigger} · <strong>Duration:</strong> ${(durationMs / 1000).toFixed(1)}s</p>`,
    `<p><strong>Run:</strong> ${runRef}</p>`,
  ];
  if (error) lines.push(`<p style="color:#b00"><strong>Error:</strong> <code>${error}</code></p>`);
  if (output) {
    lines.push(
      '<pre style="background:#111;color:#cfc;padding:12px;border-radius:6px;font-family:monospace;font-size:12px;white-space:pre-wrap">' +
        JSON.stringify(output, null, 2).replace(/</g, '&lt;') +
        '</pre>',
    );
  }
  return lines.join('\n');
}

async function maybeNotify(workflow, builtin, ctx) {
  if (!builtin.notify_on_complete) return;
  const to = process.env.ADMIN_NOTIFY_TO;
  if (!to) return; // no admin recipient configured — nothing to do
  const subject = `${workflow.name} — ${ctx.status === 'succeeded' ? 'OK' : 'FAILED'}`;
  let html;
  try {
    html = builtin.format_notification
      ? await builtin.format_notification(ctx)
      : defaultNotificationHtml({ ...ctx, workflow });
  } catch {
    html = defaultNotificationHtml({ ...ctx, workflow });
  }
  try {
    await sendMail({ to, subject, html });
  } catch (err) {
    console.error(`completion_notify_failed run=${ctx.runId}:`, err.message);
  }
}

async function executeRun(runId, workflow, input, trigger = 'manual') {
  const startedAt = Date.now();
  await db('runs').where({ id: runId }).update({ status: 'running', started_at: new Date() });
  emit(runId, { type: 'status', status: 'running' });

  const log = async (level, message) => {
    const ts = new Date();
    await db('run_logs').insert({ run_id: runId, ts, level, message });
    emit(runId, { type: 'log', ts: ts.toISOString(), level, message });
  };

  let builtin = null;
  let output = null;
  let error = null;
  let status = 'succeeded';

  try {
    if (workflow.kind !== 'builtin' || !workflow.builtin_id) {
      throw new Error(`workflow_kind_unsupported: ${workflow.kind}`);
    }
    builtin = builtins[workflow.builtin_id];
    if (!builtin) throw new Error(`unknown_builtin: ${workflow.builtin_id}`);

    // Merge workflow.config (per-workflow defaults like agent_slug) under per-call
    // input. Skip the merge for array inputs (raw webhook payloads) to avoid
    // turning indices into keys.
    let cfg = workflow.config;
    if (typeof cfg === 'string') { try { cfg = JSON.parse(cfg); } catch { cfg = {}; } }
    const mergedInput = Array.isArray(input) ? input : { ...(cfg || {}), ...(input || {}) };
    input = mergedInput;

    await log('info', `starting builtin '${workflow.builtin_id}'`);
    output = await builtin.run({ log, input: mergedInput });

    await db('runs').where({ id: runId }).update({
      status: 'succeeded',
      finished_at: new Date(),
      output: JSON.stringify(output),
    });
    await log('info', 'workflow finished');
    emit(runId, { type: 'status', status: 'succeeded', output });
  } catch (err) {
    status = 'failed';
    error = err.message;
    await db('runs').where({ id: runId }).update({
      status: 'failed',
      finished_at: new Date(),
      error: err.message,
    });
    await log('error', err.message);
    emit(runId, { type: 'status', status: 'failed', error: err.message });
  }

  if (builtin) {
    await maybeNotify(workflow, builtin, {
      status, output, error, runId, trigger, input, durationMs: Date.now() - startedAt,
    });
  }

  emit(runId, { type: 'end' });
}

async function startRun({ workflowId, trigger = 'manual', input = {} }) {
  const workflow = await db('workflows').where({ id: workflowId }).first();
  if (!workflow) throw new Error('workflow_not_found');
  const runId = crypto.randomUUID();
  await db('runs').insert({
    id: runId,
    workflow_id: workflowId,
    status: 'pending',
    trigger,
    input: JSON.stringify(input),
  });
  setImmediate(() => executeRun(runId, workflow, input, trigger));
  return runId;
}

// Ad-hoc run with no workflow row (workflow_id=NULL). Used for one-off builtin
// invocations not tied to a stored workflow.
async function startAdHocRun({ builtinId, trigger = 'manual', input = {} }) {
  const builtin = builtins[builtinId];
  if (!builtin) throw new Error(`unknown_builtin: ${builtinId}`);
  const syntheticWorkflow = {
    id: null,
    name: builtin.label || builtinId,
    kind: 'builtin',
    builtin_id: builtinId,
    config: null,
  };
  const runId = crypto.randomUUID();
  await db('runs').insert({
    id: runId,
    workflow_id: null,
    status: 'pending',
    trigger,
    input: JSON.stringify(input),
  });
  setImmediate(() => executeRun(runId, syntheticWorkflow, input, trigger));
  return runId;
}

module.exports = { startRun, startAdHocRun, subscribe };
