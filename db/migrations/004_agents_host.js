// 004 — agents.host.
// Which machine an agent's tmux session lives on. Everything that touches a
// local tmux server (pulse, terminal attach, session launch, safety-net crons)
// must only consider agents on THIS host — otherwise cross-host agents show as
// permanently 'dead', get pointless revive attempts, and wrap-up broadcasts
// spray errors. 'local' is the single-box default; a multi-host fleet sets
// FLEET_HOST in each box's .env and stamps rows accordingly.
exports.up = function up(knex) {
  return knex.schema.alterTable('agents', (t) => {
    t.string('host', 32).notNullable().defaultTo('local').index();
  });
};

exports.down = function down(knex) {
  return knex.schema.alterTable('agents', (t) => {
    t.dropColumn('host');
  });
};
