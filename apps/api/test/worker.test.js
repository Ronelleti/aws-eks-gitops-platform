// The whole queue path with a fake SQS: API (marks a task done) -> queue -> worker -> activity feed.
const test = require('node:test');
const assert = require('node:assert/strict');
const { freshDatabase, startFakeSqs, startApi, startWorker, waitFor } = require('./helpers');

const DBNAME = 'tasks_test_worker';
let sqs; let api; let worker;

test.before(async () => {
  await freshDatabase(DBNAME);
  sqs = await startFakeSqs(3971);
  api = await startApi({
    port: 3972,
    database: DBNAME,
    extraEnv: { QUEUE_URL: 'http://127.0.0.1:3971/000000000000/jobs', SQS_ENDPOINT: 'http://127.0.0.1:3971' },
  });
});
test.after(async () => {
  if (worker) await worker.stop();
  await api.stop();
  sqs.server.close();
});

const activityOf = async (id) => (await api.call('GET', `/api/tasks/${id}`)).json.activity;

test('finishing a task queues a job; other changes do not', async () => {
  const t = (await api.call('POST', '/api/tasks', { title: 'Write the report' })).json;
  await api.call('PATCH', `/api/tasks/${t.id}`, { priority: 'high' });
  await api.call('PATCH', `/api/tasks/${t.id}`, { status: 'doing' });
  assert.equal(sqs.messages.length, 0);

  assert.equal((await api.call('PATCH', `/api/tasks/${t.id}`, { status: 'done' })).status, 200);
  assert.equal(sqs.messages.length, 1);
  assert.deepEqual(
    (({ type, taskId, title }) => ({ type, taskId, title }))(JSON.parse(sqs.messages[0].body)),
    { type: 'task.completed', taskId: t.id, title: 'Write the report' },
  );
  assert.equal((await api.call('PATCH', `/api/tasks/${t.id}`, { status: 'done' })).status, 200); // no change: nothing queued
  assert.equal(sqs.messages.length, 1);
  sqs.taskId = t.id;
});

test('the worker handles the job, deletes it, and shows it in the activity feed', async () => {
  worker = await startWorker({ port: 3973, database: DBNAME, sqsPort: 3971 });
  const entry = await waitFor(async () => (await activityOf(sqs.taskId)).find((a) => a.kind === 'processed'));
  assert.match(entry.pod, /^test-worker-/); // written by the worker, not the API
  await waitFor(() => sqs.messages.length === 0); // the message was deleted
  assert.match(await worker.metrics(), /worker_jobs_total\{result="ok"\} 1/);
});

test('the same message delivered twice is processed once', async () => {
  const id = (await api.call('POST', '/api/tasks', { title: 'Twice' })).json.id;
  const body = JSON.stringify({ type: 'task.completed', taskId: id, title: 'Twice' });
  const messageId = sqs.add(body);
  await waitFor(() => !sqs.messages.some((m) => m.id === messageId));
  // SQS can deliver a message again after it was handled: simulate with the same MessageId
  sqs.messages.push({ id: messageId, body, hiddenUntil: 0, receives: 0 });
  await waitFor(() => !sqs.messages.some((m) => m.id === messageId));
  assert.equal((await activityOf(id)).filter((a) => a.kind === 'processed').length, 1);
  assert.match(await worker.metrics(), /worker_jobs_total\{result="duplicate"\} 1/);
});

test('a bad message is kept (so SQS can retry it, then move it to the DLQ) and does not stop the worker', async () => {
  const bad = sqs.add('this is not json');
  await waitFor(() => sqs.messages.find((m) => m.id === bad)?.receives >= 2); // it keeps coming back
  assert.ok(sqs.messages.some((m) => m.id === bad));
  assert.match(await worker.metrics(), /worker_jobs_total\{result="failed"\} [1-9]/);

  // the worker still works for good messages
  const id = (await api.call('POST', '/api/tasks', { title: 'After the bad one' })).json.id;
  await api.call('PATCH', `/api/tasks/${id}`, { status: 'done' });
  await waitFor(async () => (await activityOf(id)).some((a) => a.kind === 'processed'));
});

test('queue depth is exported for alerts', async () => {
  const m = await worker.metrics();
  assert.match(m, /queue_messages\{queue="jobs",state="(visible|in_flight)"\} \d+/);
});

test('a queue outage never fails the request', async () => {
  const other = await startApi({
    port: 3974, database: DBNAME,
    extraEnv: { QUEUE_URL: 'http://127.0.0.1:1/000000000000/jobs', SQS_ENDPOINT: 'http://127.0.0.1:1' },
  });
  try {
    const id = (await other.call('POST', '/api/tasks', { title: 'Queue is down' })).json.id;
    assert.equal((await other.call('PATCH', `/api/tasks/${id}`, { status: 'done' })).status, 200);
    assert.match((await other.call('GET', '/metrics')).text, /jobs_enqueued_total\{result="failed"\} 1/);
  } finally { await other.stop(); }
});

test('the worker stops cleanly on SIGTERM', async () => {
  assert.equal(await worker.stop(), 0);
  worker = null;
});
