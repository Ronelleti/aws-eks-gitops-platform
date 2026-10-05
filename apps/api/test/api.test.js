const test = require('node:test');
const assert = require('node:assert/strict');
const { freshDatabase, startFakeS3, startApi } = require('./helpers');

let api; let s3;
const DBNAME = 'tasks_test_api';

test.before(async () => {
  await freshDatabase(DBNAME);
  s3 = await startFakeS3(3956, 'test-bucket');
  api = await startApi({ port: 3955, database: DBNAME, s3Port: 3956 });
});
test.after(async () => { await api.stop(); s3.server.close(); });

test('probes and metrics', async () => {
  assert.equal((await api.call('GET', '/healthz')).status, 200);
  assert.equal((await api.call('GET', '/readyz')).json.status, 'ready');
  const m = await api.call('GET', '/metrics');
  assert.match(m.text, /tasks_by_status\{status="todo"\} 0/);
  assert.match(m.text, /db_query_duration_seconds_bucket/);
  const r = await api.call('GET', '/api/tasks');
  assert.ok(r.headers.get('x-request-id'));
  assert.equal(r.headers.get('x-served-by'), 'test-pod-3955');
});

test('creating a task: validation and defaults', async () => {
  const bad = await api.call('POST', '/api/tasks', { title: '   ' });
  assert.equal(bad.status, 400);
  assert.ok(bad.json.fields.title);
  const bad2 = await api.call('POST', '/api/tasks', { title: 'x', priority: 'urgent', due_date: '2026-02-31', tags: 'nope' });
  assert.equal(bad2.status, 400);
  assert.deepEqual(Object.keys(bad2.json.fields).sort(), ['due_date', 'priority', 'tags']);

  const ok = await api.call('POST', '/api/tasks', { title: '  Ship it  ', tags: ['Ops', 'ops', ' Docs '] });
  assert.equal(ok.status, 201);
  assert.equal(ok.json.title, 'Ship it');
  assert.equal(ok.json.status, 'todo');
  assert.equal(ok.json.priority, 'medium');
  assert.deepEqual(ok.json.tags, ['ops', 'docs']); // lowercased and de-duplicated
  assert.equal(ok.json.attachment_count, 0);

  assert.equal((await api.call('POST', '/api/tasks', 'not json at all')).status, 400);
});

test('list: search, filters and sorting', async () => {
  await api.call('POST', '/api/tasks', { title: 'Alpha deploy', priority: 'high', due_date: '2020-01-01', tags: ['aws'] });
  await api.call('POST', '/api/tasks', { title: 'Beta review', priority: 'low', notes: 'about the deploy pipeline' });
  const all = (await api.call('GET', '/api/tasks')).json;
  assert.ok(all.length >= 3);
  assert.deepEqual((await api.call('GET', '/api/tasks?q=deploy')).json.map((t) => t.title).sort(), ['Alpha deploy', 'Beta review']); // title OR notes
  assert.equal((await api.call('GET', '/api/tasks?priority=high')).json.length, 1);
  assert.equal((await api.call('GET', '/api/tasks?tag=aws')).json[0].title, 'Alpha deploy');
  assert.equal((await api.call('GET', '/api/tasks?overdue=1')).json[0].title, 'Alpha deploy');
  assert.equal((await api.call('GET', '/api/tasks?sort=priority')).json[0].priority, 'high');
});

test('updating: status keeps done and completed_at in step, and writes activity', async () => {
  const t = (await api.call('POST', '/api/tasks', { title: 'Move me' })).json;
  let r = (await api.call('PATCH', `/api/tasks/${t.id}`, { status: 'doing' })).json;
  assert.equal(r.status, 'doing');
  assert.equal(r.done, false);
  r = (await api.call('PATCH', `/api/tasks/${t.id}`, { status: 'done' })).json;
  assert.equal(r.done, true);                       // done follows the NEW status (regression: it used to read the old row)
  assert.ok(r.completed_at);
  r = (await api.call('PATCH', `/api/tasks/${t.id}`, { status: 'todo' })).json;
  assert.equal(r.done, false);
  assert.equal(r.completed_at, null);

  r = (await api.call('PATCH', `/api/tasks/${t.id}`, { done: true })).json; // first-version clients
  assert.equal(r.status, 'done');

  r = (await api.call('PATCH', `/api/tasks/${t.id}`, { title: 'Renamed', priority: 'high', due_date: '2030-05-06', tags: ['x'], notes: 'n' })).json;
  assert.equal(r.title, 'Renamed');
  assert.equal(r.due_date, '2030-05-06');           // a plain date string, not a timestamp

  assert.equal((await api.call('PATCH', `/api/tasks/${t.id}`, { priority: 'nope' })).status, 400);
  assert.equal((await api.call('PATCH', '/api/tasks/999999', { title: 'x' })).status, 404);
  assert.equal((await api.call('PATCH', '/api/tasks/abc', { title: 'x' })).status, 404);

  const detail = (await api.call('GET', `/api/tasks/${t.id}`)).json;
  const kinds = detail.activity.map((a) => a.kind);
  assert.ok(kinds.includes('created') && kinds.includes('moved') && kinds.includes('edited'));
  assert.ok(detail.activity.every((a) => a.pod === 'test-pod-3955'));
});

test('attachments: upload, confirm, download, delete', async () => {
  const t = (await api.call('POST', '/api/tasks', { title: 'With files' })).json;
  const body = Buffer.from('hello attachment');

  const asked = await api.call('POST', `/api/tasks/${t.id}/attachments`, { filename: 'my file (1).txt', contentType: 'text/plain', size: body.length });
  assert.equal(asked.status, 201);
  assert.ok(!/checksum/i.test(asked.json.uploadUrl), 'presigned URL must not carry checksum parameters (browser uploads fail)');

  // a file that never arrived cannot be confirmed
  assert.equal((await api.call('POST', `/api/attachments/${asked.json.attachment.id}/confirm`)).status, 409);

  const put = await fetch(asked.json.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body });
  assert.equal(put.status, 200);
  const confirmed = await api.call('POST', `/api/attachments/${asked.json.attachment.id}/confirm`);
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.json.size_bytes, body.length);

  const detail = (await api.call('GET', `/api/tasks/${t.id}`)).json;
  assert.equal(detail.attachment_count, 1);
  assert.equal(detail.attachments[0].filename, 'my file _1_.txt'); // unsafe characters are replaced

  const dl = await api.call('GET', `/api/attachments/${asked.json.attachment.id}/download?inline=1`);
  assert.equal(dl.status, 200);
  assert.equal(await (await fetch(dl.json.url)).text(), 'hello attachment');

  assert.equal((await api.call('DELETE', `/api/attachments/${asked.json.attachment.id}`)).status, 204);
  assert.equal((await api.call('GET', `/api/tasks/${t.id}`)).json.attachment_count, 0);
  assert.equal(s3.deleted.length >= 1, true);
});

test('attachments: too large is refused, and deleting a task deletes its files', async () => {
  const t = (await api.call('POST', '/api/tasks', { title: 'Big' })).json;
  assert.equal((await api.call('POST', `/api/tasks/${t.id}/attachments`, { filename: 'a.bin', size: 50 * 1024 * 1024 })).status, 413);

  const a = (await api.call('POST', `/api/tasks/${t.id}/attachments`, { filename: 'a.txt', contentType: 'text/plain', size: 3 })).json;
  await fetch(a.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: 'abc' });
  await api.call('POST', `/api/attachments/${a.attachment.id}/confirm`);
  const before = s3.deleted.length;
  assert.equal((await api.call('DELETE', `/api/tasks/${t.id}`)).status, 204);
  assert.equal(s3.deleted.length, before + 1);
  assert.equal((await api.call('GET', `/api/tasks/${t.id}`)).status, 404);
});

test('stats and activity feed', async () => {
  const s = (await api.call('GET', '/api/stats')).json;
  assert.equal(s.total, s.byStatus.todo + s.byStatus.doing + s.byStatus.done);
  assert.equal(s.daily.length, 14);
  assert.ok(s.overdue >= 1);
  assert.ok(Array.isArray(s.topTags));
  const feed = (await api.call('GET', '/api/activity?limit=5')).json;
  assert.equal(feed.length, 5);
  assert.ok(feed[0].id > feed[1].id); // newest first
  assert.ok(feed.some((a) => a.kind === 'deleted'));
});

test('system information', async () => {
  const s = (await api.call('GET', '/api/system')).json;
  assert.equal(s.instance.pod, 'test-pod-3955');
  assert.equal(s.database.ok, true);
  assert.equal(s.database.schemaVersion, 4);
  assert.ok(s.database.latencyMs > 0);
  assert.equal(s.storage.ok, true);
  assert.ok(s.served.total > 0);
  const info = (await api.call('GET', '/api/info')).json;
  assert.equal(info.attachments, true);
  assert.equal((await api.call('GET', '/api/nope')).status, 404);
});

test('metrics count what happened', async () => {
  const m = (await api.call('GET', '/metrics')).text;
  const read = (name) => Number(new RegExp(`^${name} (\\d+)`, 'm').exec(m)[1]);
  assert.ok(read('tasks_created_total') >= 5);
  assert.ok(read('tasks_completed_total') >= 1);
  assert.ok(read('attachments_uploaded_total') >= 2);
});

test('sample data: only on an empty board', async () => {
  const r1 = await api.call('POST', '/api/demo/seed');
  assert.equal(r1.status, 409);
  const r2 = await api.call('POST', '/api/demo/seed?force=1');
  assert.equal(r2.status, 201);
  assert.equal(r2.json.created, 14);
});

// The UI reads these exact fields. If an API change removes one, this fails before the UI breaks in production.
test('response shapes the UI depends on', async () => {
  const has = (obj, keys, what) => { for (const k of keys) assert.ok(k in obj, `${what} is missing "${k}"`); };
  const list = (await api.call('GET', '/api/tasks')).json;
  has(list[0], ['id', 'title', 'notes', 'tags', 'priority', 'status', 'done', 'due_date', 'attachment_count', 'created_at', 'updated_at', 'completed_at'], 'task');
  assert.ok(Array.isArray(list[0].tags));

  const detail = (await api.call('GET', `/api/tasks/${list[0].id}`)).json;
  has(detail, ['attachments', 'activity'], 'task detail');
  has(detail.activity[0], ['id', 'kind', 'detail', 'pod', 'created_at'], 'activity item');

  const stats = (await api.call('GET', '/api/stats')).json;
  has(stats, ['total', 'byStatus', 'openByPriority', 'overdue', 'dueSoon', 'daily', 'topTags', 'attachments', 'avgCompletionHours'], 'stats');
  has(stats.daily[0], ['day', 'created', 'completed'], 'stats.daily item');
  has(stats.attachments, ['count', 'bytes'], 'stats.attachments');

  const feed = (await api.call('GET', '/api/activity')).json;
  has(feed[0], ['id', 'task_title', 'kind', 'detail', 'pod', 'created_at'], 'feed item');

  const sys = (await api.call('GET', '/api/system')).json;
  has(sys.instance, ['pod', 'version', 'env', 'node', 'region'], 'system.instance');
  has(sys.process, ['uptimeSeconds', 'startedAt', 'node', 'rssMb', 'heapUsedMb'], 'system.process');
  has(sys.database, ['latencyMs', 'version', 'sizeBytes', 'schemaVersion', 'host', 'tls', 'pool'], 'system.database');
  has(sys.database.pool, ['total', 'idle', 'waiting'], 'system.database.pool');
  has(sys.storage, ['enabled', 'ok', 'latencyMs', 'bucket', 'region'], 'system.storage');
  has(sys.served, ['total', 'byClass'], 'system.served');
  assert.ok('2xx' in sys.served.byClass && '4xx' in sys.served.byClass && '5xx' in sys.served.byClass);

  const info = (await api.call('GET', '/api/info')).json;
  has(info, ['pod', 'version', 'env', 'attachments', 'maxUploadBytes'], 'info');
});
