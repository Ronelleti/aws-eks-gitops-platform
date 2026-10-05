const pg = require('pg');
const config = require('./config');
const log = require('./log');
const metrics = require('./metrics');

// DATE columns come back as 'YYYY-MM-DD' strings (not JS Dates, which drift with time zones),
// and BIGINT (counts, sizes) as numbers.
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(20, (v) => Number(v));

const pool = new pg.Pool(config.db);
// Without this handler a dropped idle connection (for example a Postgres restart) would crash the process.
pool.on('error', (err) => log.error({ err: err.message }, 'idle database connection lost'));

async function query(text, params = [], op = 'query') {
  const end = metrics.dbDuration.startTimer({ op });
  try {
    return await pool.query(text, params);
  } finally {
    end();
  }
}

// Runs fn(client) inside a transaction.
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, tx };
