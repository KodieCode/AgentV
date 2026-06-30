// Builtin workflow registry. Each entry is server-side code a workflow of
// kind='builtin' executes via the runner. This is the GENERALISED core only —
// every entry resolves the agent dir + shared skill path + model from .env and
// the control-plane DB. No client-specific builtins (no accounting, music, etc.).
//
// Two builtins ship here:
//   agent_build_idea — fired when an idea hits 'approved'. Shells the agent's
//                      build-idea skill (claude --print) to open a PR.
//   agent_skill_run  — generic "run one of this agent's shared skills"
//                      (weekly-review, skill-watch, daily-digest, team-review…).
//
// Adding a deployment-specific builtin = add an entry here; nothing else changes.

const fs = require('fs');
const { execFile } = require('child_process');
const db = require('../db');
const { agentDir, sharedSkill, dashboardUrl } = require('./paths');

const DEFAULT_MODEL = process.env.DEFAULT_AGENT_MODEL || 'claude-sonnet-4-6';

function runShell(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { ...opts, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout || '';
        err.stderr = stderr || '';
        return reject(err);
      }
      resolve({ stdout, stderr });
    });
  });
}

function runLink(runId) {
  const base = dashboardUrl();
  return base ? `<a href="${base}/runs/${runId}">${runId}</a>` : `<code>${runId}</code>`;
}

// Sanitise a slug for use in a filesystem path / shell arg.
function safeSlug(s) {
  const safe = String(s || '').replace(/[^a-z0-9_-]/gi, '');
  if (!safe || safe !== String(s)) throw new Error(`invalid_slug: ${s}`);
  return safe;
}

async function modelFor(slug) {
  const row = await db('agents').where({ slug }).first();
  return (row && row.model) || DEFAULT_MODEL;
}

// Env passed to every spawned skill. Inherits the parent PATH/HOME (no hardcoded
// box paths) and adds the AGENT_* overrides the shared skills expect.
function skillEnv({ slug, dir, model }) {
  return {
    ...process.env,
    AGENT_SLUG_OVERRIDE: slug,
    AGENT_DIR_OVERRIDE: dir,
    AGENT_MODEL_OVERRIDE: model,
  };
}

const builtins = {
  agent_skill_run: {
    label: 'Run an agent shared skill',
    description:
      "Runs one of the agent's shared skills (weekly-review, skill-watch, daily-digest, team-review) via claude --print in the agent's dir. Input: { agent_slug, skill }.",
    notify_on_complete: true,
    format_notification({ status, output, error, runId, durationMs, input }) {
      const agent = (input && input.agent_slug) || 'unknown';
      const skill = (input && input.skill) || 'weekly-review';
      if (status !== 'succeeded') {
        return `<h2>${skill} FAILED — ${agent}</h2>
          <p><strong>Error:</strong> <code>${error}</code></p>
          <p>Run: ${runLink(runId)}</p>`;
      }
      const o = output || {};
      return `<h2>${skill} — ${agent}</h2>
        <p>Duration: ${(durationMs / 1000).toFixed(1)}s · Run: ${runLink(runId)}</p>
        ${o.idea_submitted ? '<p><strong>idea submitted</strong></p>' : ''}
        ${o.stdout_tail ? `<pre style="font-family:monospace;font-size:11px;background:#111;color:#cfc;padding:10px;border-radius:6px;white-space:pre-wrap">${o.stdout_tail.replace(/</g, '&lt;')}</pre>` : ''}`;
    },
    async run({ log, input = {} }) {
      const slug = safeSlug(input.agent_slug);
      const skill = safeSlug(input.skill || 'weekly-review');

      const dir = agentDir(slug);
      if (!fs.existsSync(dir)) throw new Error(`agent_dir_not_found: ${dir}`);
      const runScript = sharedSkill(skill);
      if (!fs.existsSync(runScript)) throw new Error(`run_script_not_found: ${runScript}`);

      const model = await modelFor(slug);
      log('info', `${skill} starting for agent="${slug}" model="${model}" cwd=${dir}`);

      let stdout = '';
      let stderr = '';
      try {
        const res = await runShell('bash', [runScript], {
          cwd: dir,
          timeout: 10 * 60 * 1000,
          env: skillEnv({ slug, dir, model }),
        });
        stdout = res.stdout || '';
        stderr = res.stderr || '';
      } catch (err) {
        stdout = err.stdout || '';
        stderr = err.stderr || '';
        const tail = (stderr || stdout).slice(-2000);
        if (/529 Overloaded|rate.?limit|temporarily unavailable|connection.?reset/i.test(stdout + stderr)) {
          log('warn', `${skill} hit transient upstream error — safe to retry: ${tail.slice(-400)}`);
          throw new Error(`skill_run_upstream_transient_${err.code}`);
        }
        log('error', `${skill} failed (exit ${err.code}): ${tail}`);
        throw new Error(`skill_run_failed_exit_${err.code}`);
      }

      for (const line of stdout.split('\n').slice(0, 100)) {
        if (line.trim()) await log('info', line.slice(0, 300));
      }

      const idea_submitted = /\bSubmitted:?\s+idea\b|"id"\s*:\s*"[a-f0-9-]{36}"/i.test(stdout);
      const no_idea = /NO_IDEA_THIS_WEEK|no idea this week/i.test(stdout);
      log('info', `${skill} finished — idea_submitted=${idea_submitted} no_idea=${no_idea}`);

      return {
        agent_slug: slug,
        skill,
        idea_submitted,
        no_idea_marker: no_idea,
        stdout_length: stdout.length,
        stdout_tail: stdout.slice(-2000),
      };
    },
  },

  agent_build_idea: {
    label: 'Agent build approved idea',
    description:
      "Fired when an idea transitions to approved. Shells the agent's build-idea skill (claude --print) to implement the change on a feature branch and open a PR. Updates the idea row with pr_url + status=pr_open on success, or status=build_failed on any failure. Input: { agent_slug, idea_id }.",
    notify_on_complete: true,
    format_notification({ status, output, error, runId, durationMs, input }) {
      const agent = (input && input.agent_slug) || 'unknown';
      const ideaId = (input && input.idea_id) || '?';
      if (status !== 'succeeded') {
        return `<h2>Build FAILED — ${agent}</h2>
          <p><strong>Error:</strong> <code>${error}</code></p>
          <p>Idea: <code>${ideaId}</code> · Run: ${runLink(runId)}</p>`;
      }
      const o = output || {};
      const prLine = o.pr_url
        ? `<p><strong>PR opened:</strong> <a href="${o.pr_url}">${o.pr_url}</a></p>`
        : '<p><em>No PR URL captured.</em> Check logs.</p>';
      return `<h2>Build complete — ${agent}</h2>
        <p>Idea: <code>${ideaId}</code> · Branch: <code>${o.branch || '?'}</code></p>
        ${prLine}
        <p>Duration: ${(durationMs / 1000).toFixed(1)}s · Run: ${runLink(runId)}</p>`;
    },
    async run({ log, input = {} }) {
      const slug = safeSlug(input.agent_slug);
      const idea_id = input.idea_id;
      if (!idea_id) throw new Error('missing input.idea_id');

      const idea = await db('ideas')
        .leftJoin('projects', 'ideas.project_id', 'projects.id')
        .select('ideas.*', 'projects.slug as project_slug')
        .where('ideas.id', idea_id)
        .first();
      if (!idea) throw new Error(`idea_not_found: ${idea_id}`);
      if (idea.status !== 'approved' && idea.status !== 'building') {
        throw new Error(`idea_not_in_approved_state: status=${idea.status}`);
      }

      // Reflect in-progress on the kanban immediately.
      await db('ideas').where({ id: idea_id }).update({ status: 'building' });

      const dir = agentDir(slug);
      if (!fs.existsSync(dir)) throw new Error(`agent_dir_not_found: ${dir}`);
      const runScript = sharedSkill('build-idea');
      if (!fs.existsSync(runScript)) throw new Error(`run_script_not_found: ${runScript}`);

      const model = await modelFor(slug);
      log('info', `build-idea starting: agent=${slug} idea=${idea_id} project=${idea.project_slug} model=${model}`);
      log('info', `idea title="${idea.title}"`);

      let stdout = '';
      let stderr = '';
      try {
        const res = await runShell(
          'bash',
          [runScript, idea.project_slug || '', idea_id, idea.title || '', idea.body || ''],
          { cwd: dir, timeout: 20 * 60 * 1000, env: skillEnv({ slug, dir, model }) },
        );
        stdout = res.stdout || '';
        stderr = res.stderr || '';
      } catch (err) {
        stdout = err.stdout || '';
        stderr = err.stderr || '';
        const tail = (stderr || stdout).slice(-2000);
        log('error', `build-idea failed (exit ${err.code}): ${tail}`);
        // Never strand at 'building' — move to build_failed with the reason so
        // it's visible + off the Approved lane (re-approve to retry).
        await db('ideas').where({ id: idea_id }).update({
          status: 'build_failed',
          decision_reason: `auto-build failed (exit ${err.code}) — handle manually or re-approve to retry`,
        });
        throw new Error(`build_idea_failed_exit_${err.code}`);
      }

      for (const line of stdout.split('\n').slice(0, 200)) {
        if (line.trim()) await log('info', line.slice(0, 300));
      }

      // Contract: skill emits PR_URL=… + branch=… on success, or BLOCKED: … to halt.
      const prMatch = stdout.match(/PR_URL=(\S+)/);
      const branchMatch = stdout.match(/branch=(\S+)/);
      const blockedMatch = stdout.match(/BLOCKED:\s*(.+)/);
      const failedTests = /FAILED_TESTS/i.test(stdout);

      if (blockedMatch || failedTests) {
        const reason = blockedMatch ? blockedMatch[1].trim() : 'tests failed';
        log('warn', `build-idea blocked: ${reason}`);
        await db('ideas').where({ id: idea_id }).update({
          status: 'build_failed',
          decision_reason: `build blocked: ${reason}`,
        });
        return { agent_slug: slug, idea_id, blocked: true, reason, stdout_tail: stdout.slice(-2000) };
      }

      if (!prMatch) {
        log('warn', 'build-idea completed without PR_URL marker');
        await db('ideas').where({ id: idea_id }).update({
          status: 'build_failed',
          decision_reason: 'auto-build finished without opening a PR — handle manually or re-approve to retry',
        });
        return { agent_slug: slug, idea_id, pr_url: null, stdout_tail: stdout.slice(-2000) };
      }

      const pr_url = prMatch[1];
      const branch = branchMatch ? branchMatch[1] : null;
      log('info', `PR opened: ${pr_url}`);
      await db('ideas').where({ id: idea_id }).update({ status: 'pr_open', pr_url });

      return { agent_slug: slug, idea_id, pr_url, branch, stdout_tail: stdout.slice(-2000) };
    },
  },
};

module.exports = { builtins };
