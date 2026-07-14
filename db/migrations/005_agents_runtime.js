// 005 — agent runtime columns (multi-provider).
// AgentV shipped Claude-only: an agent's model was a bare string and every
// launcher hardcoded `claude`. This adds the runtime descriptor the live fleet
// gained on 2026-07-11 so a fleet can mix Claude Code, Codex CLI, and Gemini
// CLI agents on the same control plane.
//
//   provider            — vendor: 'anthropic' | 'openai' | 'google'
//   runner              — the CLI that drives the session: 'claude-code' |
//                         'codex-cli' | 'gemini-cli'. This (not provider) is
//                         what setup/start.sh + agentv_launch_cmd branch on.
//   capability_profile  — sandbox/permission level for runners that take one
//                         (codex --sandbox); Claude ignores it.
//   credential_profile  — optional pointer to a per-provider creds file/profile
//                         (e.g. an .env.provider name); NULL = use ambient login.
//   runtime_config      — JSON escape hatch for runner-specific knobs.
//
// ADDITIVE + defaulted: every existing row becomes an anthropic/claude-code
// agent, so a control plane upgraded in place keeps launching exactly as before
// until an operator opts a specific agent onto another runner. Never drop or
// rename these once shipped — a running agent's launcher reads them.
exports.up = function up(knex) {
  return knex.schema.alterTable('agents', (t) => {
    t.string('provider', 32).notNullable().defaultTo('anthropic');
    t.string('runner', 32).notNullable().defaultTo('claude-code');
    t.string('capability_profile', 32).notNullable().defaultTo('workspace-write');
    t.string('credential_profile', 64).nullable();
    t.json('runtime_config').nullable();
  });
};

exports.down = function down(knex) {
  return knex.schema.alterTable('agents', (t) => {
    t.dropColumn('provider');
    t.dropColumn('runner');
    t.dropColumn('capability_profile');
    t.dropColumn('credential_profile');
    t.dropColumn('runtime_config');
  });
};
