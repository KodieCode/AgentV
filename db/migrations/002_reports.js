// 002 — reports table.
// Human-facing briefings (daily digest, weekly self-reviews, monthly team review)
// persist here so they surface in the dashboard even when email isn't wired.
// Generation skills INSERT a row; the dashboard "Briefings" view reads it.
exports.up = function up(knex) {
  return knex.schema.createTable('reports', (t) => {
    t.uuid('id').primary();
    t.string('kind', 48).notNullable().index();        // digest | weekly_review | team_review | <custom>
    t.string('agent_slug', 64).nullable().index();     // who produced it (null = fleet-wide)
    t.string('title', 256).notNullable();
    t.text('body_md', 'mediumtext').notNullable();      // markdown body
    t.json('meta').nullable();                          // optional structured extras
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now()).index();
  });
};

exports.down = function down(knex) {
  return knex.schema.dropTableIfExists('reports');
};
