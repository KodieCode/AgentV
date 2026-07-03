const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const { execSync } = require('child_process');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { jwtAuth, requireAdmin } = require('../middleware/jwtAuth');
const { sharedSkill } = require('../lib/paths');

const router = express.Router();

// Flat routing.conf consumed by the shared notify.sh. Regenerated after any
// agent CRUD write so cross-agent routing always matches the DB. Best-effort —
// failure is logged, never thrown. Path is env-derived (SHARED_DIR), never
// hardcoded to a particular box.
const ROUTING_CONF = sharedSkill('notify', 'routing.conf');

async function regenerateRoutingConf() {
  try {
    const agents = await db('agents')
      .where({ active: true })
      .whereNotNull('tmux_session')
      .whereNotNull('inbox_path')
      .select('slug', 'inbox_path', 'tmux_session')
      .orderBy('slug');
    const lines = [
      '# Auto-generated from the agents table — do not edit manually.',
      `# Regenerated: ${new Date().toISOString()}`,
      '# Format: slug<TAB>inbox_path<TAB>tmux_session',
      ...agents.map((a) => `${a.slug}\t${a.inbox_path}\t${a.tmux_session}`),
    ];
    fs.mkdirSync(require('path').dirname(ROUTING_CONF), { recursive: true });
    fs.writeFileSync(ROUTING_CONF, lines.join('\n') + '\n', 'utf8');
  } catch (err) {
    console.error('regenerateRoutingConf failed:', err.message);
  }
}

router.use(jwtAuth);

// Issue a long-lived JWT for an agent to authenticate against this API.
// Admin-only: minting is a human decision. Token carries role='agent' +
// sub=<slug> (matches the direct-sign fallback in provisioning/new-agent.sh).
router.post('/:slug/token', requireAdmin, async (req, res) => {
  const agent = await db('agents').where({ slug: req.params.slug }).first();
  if (!agent) return res.status(404).json({ error: 'agent_not_found' });
  const token = jwt.sign(
    { sub: agent.slug, username: agent.slug, role: 'agent', agent_id: agent.id },
    process.env.JWT_SECRET,
    { expiresIn: '1y' },
  );
  res.json({ token, agent_slug: agent.slug, expires_in: '1y' });
});

router.get('/', async (_req, res) => {
  const rows = await db('agents').select('*').orderBy('created_at', 'asc');
  res.json({ agents: rows });
});

// Lightweight pulse — busy/idle/dead per agent. Cheap, pollable.
// Session map is DB-driven (agents.tmux_session) — NOT a hardcoded slug→session
// map (that map was the bug: it had to be hand-edited for every new agent and
// silently broke pulse + terminal when someone forgot).
// Detection: Claude Code shows "esc to interrupt" in the bottom status line of
// the CURRENT viewport when processing — capture only the visible pane and check
// the last few lines (scrollback produces false positives).
router.get('/pulse', async (_req, res) => {
  const agentRows = await db('agents')
    .where({ active: true })
    .whereNotNull('tmux_session')
    .select('slug', 'tmux_session')
    .orderBy('slug');
  const pulse = {};
  for (const { slug, tmux_session: session } of agentRows) {
    try {
      execSync(`tmux has-session -t ${session}`, { stdio: 'pipe' });
      const pane = execSync(`tmux capture-pane -t ${session} -p`, { encoding: 'utf8' });
      const lastLines = pane.split('\n').slice(-5).join('\n');
      pulse[slug] = lastLines.includes('esc to interrupt') ? 'busy' : 'idle';
    } catch {
      pulse[slug] = 'dead';
    }
  }
  res.json({ pulse, ts: new Date().toISOString() });
});

// Notify all active, provisioned agents to wrap up (e.g. before a group restart).
// Skips the fleet-manager (FLEET_MANAGER_SLUG) if configured, so it doesn't
// message itself. notify.sh path + message are env/config-driven, not hardcoded.
// Admin-only: broadcasting wake prompts into every session is fleet control.
router.post('/wrap-up-all', requireAdmin, async (_req, res) => {
  const agents = await db('agents')
    .where({ active: true })
    .whereNotNull('tmux_session')
    .select('slug')
    .orderBy('slug');
  const NOTIFY = sharedSkill('notify', 'notify.sh');
  const manager = process.env.FLEET_MANAGER_SLUG || null;
  const MSG = 'Wrap up — group request. Save your session note, promote any new rules to memory, then reply confirming. Ready for restart.';
  const results = [];
  for (const a of agents) {
    if (manager && a.slug === manager) continue;
    try {
      execSync(`${NOTIFY} --to ${a.slug} --wake ${JSON.stringify(MSG)}`, { stdio: 'pipe', timeout: 10_000 });
      results.push({ slug: a.slug, ok: true });
    } catch (e) {
      results.push({ slug: a.slug, ok: false, error: e.message.slice(0, 200) });
    }
  }
  res.json({ sent: results.filter((r) => r.ok).length, total: results.length, results });
});

// Bundled per-agent dashboard payload. One round-trip; powers /agent/:slug.
router.get('/:slug/dashboard', async (req, res) => {
  const agent = await db('agents').where({ slug: req.params.slug }).first();
  if (!agent) return res.status(404).json({ error: 'agent_not_found' });

  const [projects, workflows, schedules, ideas, recentRuns, liveRun, centralJobs, stats14d, hourly24h] =
    await Promise.all([
      db('projects').where({ agent_id: agent.id }).orderBy('name', 'asc'),

      db('workflows').where({ agent_id: agent.id }).orderBy('name', 'asc'),

      db('schedules as s')
        .join('workflows as w', 's.workflow_id', 'w.id')
        .where('w.agent_id', agent.id)
        .select(
          's.id', 's.cron_expr', 's.enabled', 's.last_fired_at', 's.next_fire_at',
          'w.id as workflow_id', 'w.slug as workflow_slug', 'w.name as workflow_name',
        )
        .orderBy('s.next_fire_at', 'asc'),

      db('ideas')
        .where({ agent_id: agent.id })
        .whereIn('status', ['new', 'approved', 'building', 'build_failed', 'pr_open'])
        .orderBy('created_at', 'desc')
        .limit(20),

      db('runs as r')
        .leftJoin('workflows as w', 'r.workflow_id', 'w.id')
        .where('w.agent_id', agent.id)
        .select(
          'r.id', 'r.status', 'r.trigger', 'r.started_at', 'r.finished_at', 'r.error',
          'w.slug as workflow_slug', 'w.name as workflow_name',
        )
        .orderBy('r.started_at', 'desc')
        .limit(15),

      db('runs as r')
        .leftJoin('workflows as w', 'r.workflow_id', 'w.id')
        .where('w.agent_id', agent.id)
        .whereIn('r.status', ['running', 'pending'])
        .select('r.id', 'r.status', 'r.started_at', 'w.slug as workflow_slug', 'w.name as workflow_name')
        .orderBy('r.started_at', 'desc')
        .first(),

      db('agent_jobs').where({ agent_id: agent.id }).whereNot('status', 'deleted').orderBy('next_run_at', 'asc'),

      db.raw(
        `SELECT DATE(r.started_at) AS day,
                SUM(CASE WHEN r.status='succeeded' THEN 1 ELSE 0 END) AS success,
                SUM(CASE WHEN r.status='failed'    THEN 1 ELSE 0 END) AS error
         FROM runs r LEFT JOIN workflows w ON r.workflow_id = w.id
         WHERE w.agent_id = ? AND r.started_at > DATE_SUB(NOW(), INTERVAL 14 DAY)
         GROUP BY DATE(r.started_at) ORDER BY day ASC`,
        [agent.id],
      ),

      db.raw(
        `SELECT HOUR(r.started_at) AS hour, COUNT(*) AS count
         FROM runs r LEFT JOIN workflows w ON r.workflow_id = w.id
         WHERE w.agent_id = ? AND r.started_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)
         GROUP BY HOUR(r.started_at) ORDER BY hour ASC`,
        [agent.id],
      ),
    ]);

  const jobs = centralJobs.map((j) => ({
    id: j.id,
    source: 'central',
    name: j.name,
    cron_expression: j.cron_expression,
    status: j.status,
    next_run_at: j.next_run_at,
    last_run_at: j.last_run_at,
    last_status: j.last_status,
    run_count: j.run_count,
    error_count: j.error_count,
  }));

  // Unified TASKS list — every job-shaped thing this agent has, regardless of
  // underlying table, each with a trigger so the UI renders one card type.
  const scheduleByWfId = Object.fromEntries(schedules.map((s) => [s.workflow_id, s]));
  const tasks = [
    ...workflows.map((w) => {
      const sched = scheduleByWfId[w.id];
      let trigger = 'manual';
      let trigger_detail = null;
      if (sched) {
        trigger = 'cron';
        trigger_detail = sched.cron_expr;
      } else if (w.kind === 'webhook' || w.kind === 'event') {
        trigger = w.kind;
      }
      return {
        key: `wf:${w.id}`,
        kind: 'builtin',
        name: w.name || w.slug,
        slug: w.slug,
        trigger,
        trigger_detail,
        last_at: sched?.last_fired_at || null,
        next_at: sched?.next_fire_at || null,
        last_status: null,
        link: `/workflows/${w.id}/runs`,
        workflow_id: w.id,
      };
    }),
    ...jobs.map((j) => ({
      key: `job:${j.id}`,
      kind: 'agent',
      name: j.name,
      slug: j.id,
      trigger: 'cron',
      trigger_detail: j.cron_expression,
      last_at: j.last_run_at,
      next_at: j.next_run_at,
      last_status: j.last_status,
      link: `/agent/${agent.slug}/job/${j.id}`,
    })),
  ];

  // Stats from the chart queries.
  const totalSuccess14d = stats14d[0].reduce((n, r) => n + Number(r.success || 0), 0);
  const totalError14d = stats14d[0].reduce((n, r) => n + Number(r.error || 0), 0);
  const totalRuns14d = totalSuccess14d + totalError14d;
  const totalRuns24h = hourly24h[0].reduce((n, r) => n + Number(r.count || 0), 0);
  const totalRuns7d = stats14d[0].slice(-7).reduce((n, r) => n + Number(r.success || 0) + Number(r.error || 0), 0);
  const successRate14d = totalRuns14d > 0 ? Math.round((totalSuccess14d / totalRuns14d) * 100) : null;

  // Pad daily buckets so missing days show as 0.
  const days = [];
  const today = new Date();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const iso = d.toISOString().slice(0, 10);
    const row = stats14d[0].find((r) => {
      const rowDay = (r.day instanceof Date ? r.day : new Date(r.day)).toISOString().slice(0, 10);
      return rowDay === iso;
    });
    days.push({ date: iso, success: Number(row?.success || 0), error: Number(row?.error || 0) });
  }

  // Pad hourly buckets (0-23).
  const hours = [];
  for (let h = 0; h < 24; h++) {
    const row = hourly24h[0].find((r) => Number(r.hour) === h);
    hours.push({ hour: h, count: Number(row?.count || 0) });
  }

  const stats = {
    jobs_count: tasks.length,
    runs_24h: totalRuns24h,
    runs_7d: totalRuns7d,
    success_rate_14d: successRate14d,
    daily_buckets: days,
    hourly_buckets: hours,
  };

  res.json({ agent, live: liveRun || null, projects, workflows, schedules, jobs, tasks, stats, ideas, recentRuns });
});

// Per-job execution history (drill-down).
router.get('/:slug/jobs/:jobId/executions', async (req, res) => {
  const agent = await db('agents').where({ slug: req.params.slug }).first();
  if (!agent) return res.status(404).json({ error: 'agent_not_found' });
  const job = await db('agent_jobs').where({ id: req.params.jobId, agent_id: agent.id }).first();
  if (!job) return res.status(404).json({ error: 'job_not_found' });
  const executions = await db('agent_job_executions')
    .where({ job_id: job.id })
    .orderBy('started_at', 'desc')
    .limit(50);
  res.json({ job, executions });
});

// Single execution detail (full stdout).
router.get('/:slug/executions/:execId', async (req, res) => {
  const agent = await db('agents').where({ slug: req.params.slug }).first();
  if (!agent) return res.status(404).json({ error: 'agent_not_found' });
  const exec = await db('agent_job_executions as e')
    .join('agent_jobs as j', 'e.job_id', 'j.id')
    .where('e.id', req.params.execId)
    .where('j.agent_id', agent.id)
    .select('e.*', 'j.name as job_name', 'j.cron_expression')
    .first();
  if (!exec) return res.status(404).json({ error: 'execution_not_found' });
  res.json({ execution: exec });
});

// Per-agent open PRs — filter org-wide search by the agent's branch prefix.
// Org comes from GITHUB_ORG (.env), never hardcoded.
router.get('/:slug/prs', (req, res) => {
  const org = process.env.GITHUB_ORG;
  if (!org) return res.status(501).json({ error: 'github_org_not_configured' });
  const slug = req.params.slug;
  const branchPrefix = `agent/${slug}/`;
  try {
    const query = `{ search(query: "org:${org} is:pr is:open", type: ISSUE, first: 100) { nodes { ... on PullRequest { number title url isDraft createdAt headRefName reviewDecision author { login } repository { nameWithOwner name } } } } }`;
    const raw = execSync(`gh api graphql -f query=${JSON.stringify(query)}`, {
      timeout: 15000, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
    });
    const parsed = JSON.parse(raw);
    const all = parsed.data?.search?.nodes || [];
    const prs = all
      .filter((n) => n && n.headRefName && n.headRefName.startsWith(branchPrefix))
      .map((n) => ({
        repo: n.repository.name,
        repoFull: n.repository.nameWithOwner,
        number: n.number,
        title: n.title,
        branch: n.headRefName,
        author: n.author?.login || 'unknown',
        createdAt: n.createdAt,
        reviewDecision: n.reviewDecision || null,
        isDraft: !!n.isDraft,
        url: n.url,
      }));
    res.json({ prs });
  } catch (e) {
    res.status(502).json({ error: 'prs_fetch_failed', detail: e.message });
  }
});

// Team view: each agent + current/last activity + owned projects. Pollable.
router.get('/team', async (_req, res) => {
  const agents = await db('agents').select('*').orderBy('created_at', 'asc');
  const result = [];
  for (const a of agents) {
    const live = await db('runs')
      .leftJoin('workflows', 'runs.workflow_id', 'workflows.id')
      .select(
        'runs.id as run_id', 'runs.status as run_status',
        'workflows.slug as workflow_slug', 'workflows.name as workflow_name', 'runs.started_at',
      )
      .where('workflows.agent_id', a.id)
      .whereIn('runs.status', ['running', 'pending'])
      .orderBy('runs.started_at', 'desc')
      .first();

    const lastRun = await db('runs')
      .leftJoin('workflows', 'runs.workflow_id', 'workflows.id')
      .select('runs.id as run_id', 'runs.status as run_status', 'workflows.slug as workflow_slug', 'runs.finished_at')
      .where('workflows.agent_id', a.id)
      .whereIn('runs.status', ['succeeded', 'failed'])
      .orderBy('runs.finished_at', 'desc')
      .first();

    const projects = await db('projects').where({ agent_id: a.id }).select('slug', 'name');

    result.push({ ...a, live_run: live || null, last_run: lastRun || null, projects });
  }
  res.json({ team: result });
});

router.post('/', requireAdmin, async (req, res) => {
  const {
    slug, name, description, avatar_url, model,
    active = true, tmux_session = null, inbox_path = null,
  } = req.body || {};
  if (!slug || !name) return res.status(400).json({ error: 'missing_fields' });
  const id = crypto.randomUUID();
  await db('agents').insert({
    id, slug, name, description, avatar_url,
    model: model || process.env.DEFAULT_AGENT_MODEL || 'claude-sonnet-5',
    active, tmux_session, inbox_path,
  });
  const row = await db('agents').where({ id }).first();
  regenerateRoutingConf(); // best-effort, no await
  res.json({ agent: row });
});

router.patch('/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const allowed = ['name', 'description', 'avatar_url', 'model', 'active', 'tmux_session', 'inbox_path'];
  const patch = {};
  for (const k of allowed) if (k in (req.body || {})) patch[k] = req.body[k];
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'nothing_to_update' });
  patch.updated_at = new Date();
  const n = await db('agents').where({ id }).update(patch);
  if (!n) return res.status(404).json({ error: 'not_found' });
  const row = await db('agents').where({ id }).first();
  regenerateRoutingConf(); // best-effort, no await
  res.json({ agent: row });
});

router.delete('/:id', requireAdmin, async (req, res) => {
  const n = await db('agents').where({ id: req.params.id }).del();
  if (!n) return res.status(404).json({ error: 'not_found' });
  regenerateRoutingConf(); // best-effort, no await
  res.json({ ok: true });
});

module.exports = router;
