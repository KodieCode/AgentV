// 006 — agentv_meta: a small key/value store for control-plane state that
// isn't an entity of its own. First use: the version-check skill writes the
// "is a newer AgentV available?" result here (nightly), and the dashboard
// /v1/version endpoint reads it to show an update banner.
//
// Additive + free-standing (no FK), so an in-place upgrade adds it without
// touching anything a running agent reads.
exports.up = function up(knex) {
  return knex.schema.createTable('agentv_meta', (t) => {
    t.string('k', 64).notNullable().primary();
    t.text('v');
    t.datetime('updated_at').notNullable().defaultTo(knex.fn.now());
  });
};

exports.down = function down(knex) {
  return knex.schema.dropTableIfExists('agentv_meta');
};
