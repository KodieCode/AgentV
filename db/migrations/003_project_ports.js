// 003 — per-project ports.
// When the fleet builds a new app/dashboard it must record its ports so nothing
// clashes and the dashboard can show them. The projects table IS the port
// registry (queryable); port-allocate reads it + live listeners to pick free ones.
exports.up = function up(knex) {
  return knex.schema.alterTable('projects', (t) => {
    t.integer('app_port').nullable();   // frontend / app dev or served port
    t.integer('api_port').nullable();   // backend / api port
  });
};

exports.down = function down(knex) {
  return knex.schema.alterTable('projects', (t) => {
    t.dropColumn('app_port');
    t.dropColumn('api_port');
  });
};
