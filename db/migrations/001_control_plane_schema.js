// 001 — control-plane schema.
// Applies db/schema.sql (the extracted, generalised control-plane DDL: agents,
// ideas, workflows, schedules, runs, run_logs, projects, project_repos,
// connectors, agent_jobs, agent_job_executions, users). Kept as raw SQL so the
// onboarded schema is byte-identical to the proven source — no translation drift.
const fs = require('fs');
const path = require('path');

const SCHEMA = path.resolve(__dirname, '../schema.sql');

// Split a mysqldump into individual statements (naive but fine for DDL — no
// stored routines / no embedded semicolons in our control-plane DDL).
function statements(sql) {
  return sql
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('--') && !/^\/\*.*\*\/$/.test(s));
}

exports.up = async function up(knex) {
  const sql = fs.readFileSync(SCHEMA, 'utf8');
  await knex.raw('SET FOREIGN_KEY_CHECKS=0');
  for (const stmt of statements(sql)) {
    await knex.raw(stmt);
  }
  await knex.raw('SET FOREIGN_KEY_CHECKS=1');
};

exports.down = async function down(knex) {
  const tables = [
    'agent_job_executions', 'agent_jobs', 'run_logs', 'runs', 'schedules',
    'workflows', 'ideas', 'project_repos', 'projects', 'connectors', 'users', 'agents',
  ];
  await knex.raw('SET FOREIGN_KEY_CHECKS=0');
  for (const t of tables) await knex.schema.dropTableIfExists(t);
  await knex.raw('SET FOREIGN_KEY_CHECKS=1');
};
