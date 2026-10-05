// Schema migrations, applied in order at startup.
//
// Rules that keep rolling updates safe: migrations only ADD things (columns, tables, indexes).
// Old pods keep working against the new schema while the new pods roll out. Removing a column
// is a later migration, once no old version is running.
const log = require('./log');
const { pool } = require('./db');

const MIGRATIONS = [
  {
    id: 1,
    name: 'baseline tasks table',
    sql: [
      `CREATE TABLE IF NOT EXISTS tasks (
         id SERIAL PRIMARY KEY,
         title TEXT NOT NULL,
         done BOOLEAN NOT NULL DEFAULT false,
         attachment_key TEXT,
         created_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
    ],
  },
  {
    id: 2,
    name: 'status, priority, due date, notes, tags',
    sql: [
      `ALTER TABLE tasks
         ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','doing','done')),
         ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high')),
         ADD COLUMN IF NOT EXISTS due_date DATE,
         ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '',
         ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}',
         ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
         ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`,
      // tasks that were already ticked off in the first version
      `UPDATE tasks SET status = 'done', completed_at = COALESCE(completed_at, created_at)
         WHERE done = true AND status = 'todo'`,
      `CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks (status)`,
      `CREATE INDEX IF NOT EXISTS tasks_due_idx ON tasks (due_date) WHERE due_date IS NOT NULL`,
    ],
  },
  {
    id: 3,
    name: 'attachments table',
    sql: [
      `CREATE TABLE IF NOT EXISTS attachments (
         id SERIAL PRIMARY KEY,
         task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
         s3_key TEXT NOT NULL,
         filename TEXT NOT NULL,
         content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
         size_bytes BIGINT NOT NULL DEFAULT 0,
         status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready')),
         created_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
      `CREATE INDEX IF NOT EXISTS attachments_task_idx ON attachments (task_id)`,
      // the single file the first version could attach
      `INSERT INTO attachments (task_id, s3_key, filename, status)
         SELECT t.id, t.attachment_key, regexp_replace(t.attachment_key, '^.*/[0-9]+-', ''), 'ready'
         FROM tasks t
         WHERE t.attachment_key IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM attachments a WHERE a.s3_key = t.attachment_key)`,
    ],
  },
  {
    id: 4,
    name: 'activity feed',
    sql: [
      `CREATE TABLE IF NOT EXISTS activity (
         id BIGSERIAL PRIMARY KEY,
         task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
         task_title TEXT NOT NULL DEFAULT '',
         kind TEXT NOT NULL,
         detail TEXT NOT NULL DEFAULT '',
         pod TEXT NOT NULL DEFAULT '',
         created_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
      `CREATE INDEX IF NOT EXISTS activity_created_idx ON activity (created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS activity_task_idx ON activity (task_id)`,
    ],
  },
];

const LOCK_ID = 727274; // arbitrary number identifying "the migration lock"

async function migrate() {
  const client = await pool.connect();
  try {
    // With several replicas starting at once, only one may run migrations at a time.
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    const done = new Set((await client.query('SELECT id FROM schema_migrations')).rows.map((r) => r.id));

    for (const m of MIGRATIONS) {
      if (done.has(m.id)) continue;
      await client.query('BEGIN');
      try {
        for (const statement of m.sql) await client.query(statement);
        await client.query('INSERT INTO schema_migrations (id, name) VALUES ($1, $2)', [m.id, m.name]);
        await client.query('COMMIT');
        log.info({ migration: m.id, name: m.name }, 'migration applied');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
    return MIGRATIONS[MIGRATIONS.length - 1].id;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    client.release();
  }
}

module.exports = { migrate, MIGRATIONS };
