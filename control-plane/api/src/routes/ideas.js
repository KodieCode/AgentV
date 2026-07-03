const express = require('express');
const crypto = require('crypto');
const { execFile } = require('child_process');
const db = require('../db');
const { jwtAuth } = require('../middleware/jwtAuth');
const { startRun } = require('../lib/runner');

const router = express.Router();

const VALID_STATUS = ['new', 'approved', 'building', 'build_failed', 'pr_open', 'done', 'rejected'];

// Transitions that are HUMAN decisions. 'approved' fires the auto-build,
// 'done' triggers a server-side `gh pr merge` — an agent token must never be
// able to approve its own idea or merge its own PR. (The build lifecycle
// transitions — building / build_failed / pr_open — are set server-side by the
// agent_build_idea builtin via direct DB writes, so agents don't need any
// status PATCH for the normal flow.)
const ADMIN_TRANSITIONS = new Set(['approved', 'done']);

function parsePrUrl(url) {
  if (!url) return null;
  const m = String(url).match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!m) return null;
  return { owner: m[1], repo: m[2], number: m[3] };
}

// gh runs with the parent process env (inherits PATH/HOME) — nothing box-specific.
const GH_ENV = { ...process.env };

function isPrMerged({ owner, repo, number }) {
  return new Promise((resolve) => {
    execFile(
      'gh',
      ['pr', 'view', String(number), '--repo', `${owner}/${repo}`, '--json', 'state', '--jq', '.state'],
      { env: GH_ENV, timeout: 15 * 1000 },
      (err, stdout) => {
        if (err) resolve(false);
        else resolve(stdout.trim() === 'MERGED');
      },
    );
  });
}

function mergePr({ owner, repo, number }) {
  return new Promise((resolve) => {
    execFile(
      'gh',
      ['pr', 'merge', String(number), '--repo', `${owner}/${repo}`, '--squash', '--delete-branch'],
      { env: GH_ENV, timeout: 60 * 1000 },
      (err, stdout, stderr) => {
        if (err) resolve({ ok: false, error: (stderr || stdout || err.message).slice(0, 500) });
        else resolve({ ok: true, output: (stdout || '').slice(0, 500) });
      },
    );
  });
}

function fingerprint(title) {
  const norm = String(title).toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  return crypto.createHash('sha256').update(norm).digest('hex').slice(0, 32);
}

// GET /v1/ideas — kanban data
router.get('/', jwtAuth, async (req, res) => {
  const q = db('ideas')
    .leftJoin('agents', 'ideas.agent_id', 'agents.id')
    .leftJoin('projects', 'ideas.project_id', 'projects.id')
    .select(
      'ideas.*',
      'agents.slug as agent_slug', 'agents.name as agent_name',
      'projects.slug as project_slug', 'projects.name as project_name',
    )
    .orderBy('ideas.created_at', 'desc');
  if (req.query.status) q.where('ideas.status', req.query.status);
  if (req.query.project) q.where('projects.slug', req.query.project);
  if (req.query.agent) q.where('agents.slug', req.query.agent);
  const rows = await q;
  res.json({ ideas: rows });
});

router.get('/:id', jwtAuth, async (req, res) => {
  const row = await db('ideas')
    .leftJoin('agents', 'ideas.agent_id', 'agents.id')
    .leftJoin('projects', 'ideas.project_id', 'projects.id')
    .select('ideas.*', 'agents.slug as agent_slug', 'projects.slug as project_slug')
    .where('ideas.id', req.params.id)
    .first();
  if (!row) return res.status(404).json({ error: 'not_found' });
  res.json({ idea: row });
});

// POST /v1/ideas — an agent submits a new idea.
router.post('/', jwtAuth, async (req, res) => {
  const { agent_slug, project_slug, title, body, impact_score, effort_score } = req.body || {};
  if (!agent_slug || !project_slug || !title) {
    return res.status(400).json({ error: 'missing_fields', required: ['agent_slug', 'project_slug', 'title'] });
  }
  const agent = await db('agents').where({ slug: agent_slug }).first();
  if (!agent) return res.status(400).json({ error: 'unknown_agent' });
  const project = await db('projects').where({ slug: project_slug }).first();
  if (!project) return res.status(400).json({ error: 'unknown_project' });

  const fp = fingerprint(title);
  // Dedupe — return the existing open idea with the same fingerprint, if any.
  const existing = await db('ideas')
    .where({ project_id: project.id, dedupe_fingerprint: fp })
    .whereNotIn('status', ['done', 'rejected'])
    .first();
  if (existing) return res.status(200).json({ idea: existing, deduped: true });

  const id = crypto.randomUUID();
  await db('ideas').insert({
    id,
    agent_id: agent.id,
    project_id: project.id,
    status: 'new',
    title: String(title).slice(0, 200),
    body: body || null,
    impact_score: impact_score != null ? Number(impact_score) : null,
    effort_score: effort_score != null ? Number(effort_score) : null,
    dedupe_fingerprint: fp,
  });
  const row = await db('ideas').where({ id }).first();
  res.status(201).json({ idea: row, deduped: false });
});

// PATCH /v1/ideas/:id/status — full lifecycle transitions.
router.patch('/:id/status', jwtAuth, async (req, res) => {
  const { status, decision_reason, spec_path, pr_url } = req.body || {};
  if (!VALID_STATUS.includes(status)) {
    return res.status(400).json({ error: 'invalid_status', allowed: VALID_STATUS });
  }
  if (ADMIN_TRANSITIONS.has(status) && req.auth_user.role !== 'admin') {
    return res.status(403).json({ error: 'admin_required', detail: `status '${status}' is an operator decision` });
  }

  const current = await db('ideas').where({ id: req.params.id }).first();
  if (!current) return res.status(404).json({ error: 'not_found' });

  // pr_open → done with a PR URL: squash-merge first. Refuse the flip if the
  // merge fails so the kanban stays accurate. If the PR is already merged
  // (e.g. merged manually), treat as success and don't block the flip.
  let mergeResult = null;
  let deployRunId = null;
  if (status === 'done' && current.status === 'pr_open' && current.pr_url) {
    const parsed = parsePrUrl(current.pr_url);
    if (!parsed) return res.status(422).json({ error: 'unparseable_pr_url', pr_url: current.pr_url });

    const alreadyMerged = await isPrMerged(parsed);
    if (alreadyMerged) {
      mergeResult = { ok: true, output: 'PR already merged — status flip only' };
    } else {
      mergeResult = await mergePr(parsed);
      if (!mergeResult.ok) {
        return res.status(422).json({ error: 'merge_failed', pr_url: current.pr_url, gh_output: mergeResult.error });
      }
    }

    // Merge succeeded. If the project has auto_deploy + a <project_slug>_deploy
    // workflow, fire it. Best-effort — deploy failure doesn't block the flip.
    const projRow = await db('ideas')
      .leftJoin('projects', 'ideas.project_id', 'projects.id')
      .select('projects.id as project_id', 'projects.slug as project_slug', 'projects.auto_deploy')
      .where('ideas.id', req.params.id)
      .first();
    if (projRow?.auto_deploy && projRow?.project_slug) {
      const wf = await db('workflows').where({ slug: `${projRow.project_slug}_deploy`, active: true }).first();
      if (wf) {
        try {
          deployRunId = await startRun({
            workflowId: wf.id,
            trigger: 'pr_merged',
            input: { project_slug: projRow.project_slug },
          });
        } catch (err) {
          console.error(`failed_to_start_deploy_run project=${projRow.project_slug}:`, err.message);
        }
      } else {
        console.warn(`no_deploy_workflow_for_project=${projRow.project_slug}`);
      }
    }
  }

  const patch = {
    status,
    decided_at: new Date(),
    decided_by: req.auth_user?.username || 'unknown',
  };
  if (decision_reason !== undefined) patch.decision_reason = decision_reason;
  if (spec_path !== undefined) patch.spec_path = spec_path;
  if (pr_url !== undefined) patch.pr_url = pr_url;
  if (mergeResult?.ok) {
    patch.decision_reason = `merged via gh: ${mergeResult.output.split('\n')[0]}`.slice(0, 500);
  }
  await db('ideas').where({ id: req.params.id }).update(patch);

  // On transition to 'approved', auto-fire the per-agent build workflow.
  // Convention: workflow slug = `<agent_slug>_build_idea`.
  let buildRunId = null;
  if (status === 'approved') {
    const idea = await db('ideas')
      .leftJoin('agents', 'ideas.agent_id', 'agents.id')
      .select('ideas.id', 'agents.slug as agent_slug', 'agents.id as agent_id')
      .where('ideas.id', req.params.id)
      .first();
    if (idea && idea.agent_slug) {
      const wf = await db('workflows')
        .where({ agent_id: idea.agent_id, slug: `${idea.agent_slug}_build_idea`, active: true })
        .first();
      if (wf) {
        try {
          buildRunId = await startRun({
            workflowId: wf.id,
            trigger: 'idea_approved',
            input: { agent_slug: idea.agent_slug, idea_id: idea.id },
          });
          await db('ideas').where({ id: idea.id }).update({ build_run_id: buildRunId });
        } catch (err) {
          console.error(`failed_to_start_build_run idea=${idea.id}:`, err.message);
        }
      } else {
        // No auto-build workflow for this agent — record WHY so the idea doesn't
        // sit mysteriously in 'approved'. Build manually or add the workflow.
        console.warn(`no_build_workflow_for_agent=${idea.agent_slug} — idea ${idea.id} approved but build not fired`);
        await db('ideas').where({ id: idea.id }).update({
          decision_reason: `approved — no auto-build workflow for ${idea.agent_slug}; build manually or add a ${idea.agent_slug}_build_idea workflow`,
        });
      }
    }
  }

  const row = await db('ideas').where({ id: req.params.id }).first();
  res.json({ idea: row, build_run_id: buildRunId, merged: mergeResult?.ok || false, deploy_run_id: deployRunId });
});

module.exports = router;
