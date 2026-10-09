const test = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('pg');
const { DB, freshDatabase, startApi } = require('./helpers');

test('upgrades a database created by the first version of the app, keeping its data', async () => {
  const name = await freshDatabase('tasks_test_upgrade');
  const c = new Client({ ...DB, database: name });
  await c.connect();
  // exactly what version 1 created
  await c.query(`CREATE TABLE tasks (id SERIAL PRIMARY KEY, title TEXT NOT NULL, done BOOLEAN NOT NULL DEFAULT false,
                 attachment_key TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  await c.query(`INSERT INTO tasks (title, done, attachment_key) VALUES ('old open', false, NULL), ('old done', true, 'tasks/2/1791-photo.jpg')`);

  const api = await startApi({ port: 3957, database: name });
  try {
    const list = (await api.call('GET', '/api/tasks?sort=created')).json;
    const open = list.find((t) => t.title === 'old open');
    const done = list.find((t) => t.title === 'old done');
    assert.equal(open.status, 'todo');
    assert.equal(done.status, 'done');            // done=true became status done
    assert.ok(done.completed_at);
    const detail = (await api.call('GET', `/api/tasks/${done.id}`)).json;
    assert.equal(detail.attachments[0].filename, 'photo.jpg'); // the old single attachment moved into the new table
  } finally { await api.stop(); await c.end(); }
});

test('several replicas starting at once do not fight over migrations', async () => {
  const name = await freshDatabase('tasks_test_race');
  const apis = await Promise.all([3958, 3959, 3960].map((port) => startApi({ port, database: name })));
  try {
    for (const a of apis) assert.equal((await a.call('GET', '/readyz')).status, 200);
    const c = new Client({ ...DB, database: name });
    await c.connect();
    const { rows } = await c.query('SELECT id FROM schema_migrations ORDER BY id');
    await c.end();
    assert.deepEqual(rows.map((r) => r.id), [1, 2, 3, 4, 5]); // each migration exactly once
  } finally { await Promise.all(apis.map((a) => a.stop())); }
});

test('liveness never depends on the database; readiness does', async () => {
  const { spawn } = require('child_process');
  const path = require('path');
  const child = spawn('node', [path.join(__dirname, '..', 'src', 'index.js')], {
    env: { ...process.env, PORT: '3961', DB_HOST: '127.0.0.1', DB_PORT: '1', LOG_LEVEL: 'silent' }, stdio: 'ignore',
  });
  try {
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal((await fetch('http://127.0.0.1:3961/healthz')).status, 200);
    assert.equal((await fetch('http://127.0.0.1:3961/readyz')).status, 503);
  } finally { child.kill(); }
});
