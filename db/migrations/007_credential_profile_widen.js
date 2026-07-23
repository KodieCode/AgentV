// 007 — widen agents.credential_profile from varchar(64) to varchar(255).
// 005 shipped it at 64, sized for a bare profile name. But a credential_profile
// in practice holds a runtime pointer like `env-file:/secure/<provider>.env` —
// an absolute path that overruns 64 chars and gets SILENTLY TRUNCATED by MySQL,
// so the launcher later resolves a chopped path and the agent starts with no
// provider creds. The live fleet hit this and widened to 255; this ports that.
//
// ADDITIVE + non-destructive: only grows the column, never shrinks or drops.
// down() narrows back to 64 (may truncate — matches the original size, and
// down-migrations are dev-only).
exports.up = function up(knex) {
  return knex.schema.alterTable('agents', (t) => {
    t.string('credential_profile', 255).nullable().alter();
  });
};

exports.down = function down(knex) {
  return knex.schema.alterTable('agents', (t) => {
    t.string('credential_profile', 64).nullable().alter();
  });
};
