// Single shared knex instance. Reuses the repo-level knexfile (../../db) so the
// API and migrations connect with identical pool + timezone settings. The
// knexfile loads ../../.env with override:true — .env is the source of truth.
const knexConfig = require('../../../db/knexfile');

const env = process.env.NODE_ENV === 'production' ? 'production' : 'development';
const knex = require('knex')(knexConfig[env]);

module.exports = knex;
