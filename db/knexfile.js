// AgentV — knex config. Connection comes entirely from .env so the same repo
// runs against any deployment's MySQL by filling .env at onboarding.
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const base = {
  client: 'mysql2',
  connection: {
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    timezone: '+00:00', // store/read UTC — bare strings break BST/DST by 1h
  },
  pool: {
    min: 0,                       // release idle conns (RDS kills them otherwise)
    acquireTimeoutMillis: 30000,
    idleTimeoutMillis: 30000,
  },
  migrations: {
    directory: './migrations',
    tableName: 'knex_migrations',
  },
};

module.exports = { development: base, production: base };
