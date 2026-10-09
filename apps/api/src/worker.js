// Background worker: reads jobs from the SQS queue and processes them. Same image as the API, different command
// (node src/worker.js), so there is one build and one version to deploy.
//
// Delivery is "at least once": SQS can hand out the same message twice, and a message that fails comes back
// after the visibility timeout. After a few failed tries the queue moves it to the dead-letter queue (DLQ).
// So a job must be safe to run twice (processed_jobs records each message id) and must throw when it fails.
const http = require('http');
const prom = require('prom-client');
const config = require('./config');
const log = require('./log');
const { pool, tx } = require('./db');
const { migrate } = require('./migrations');
const queue = require('./queue');

// Own metrics registry: this process must not expose the API's metrics (tasks_by_status and so on).
const registry = new prom.Registry();
prom.collectDefaultMetrics({ register: registry });
const jobs = new prom.Counter({
  name: 'worker_jobs_total', help: 'Jobs handled by the worker', labelNames: ['result'], registers: [registry],
});
const jobSeconds = new prom.Histogram({
  name: 'worker_job_duration_seconds', help: 'Time to process one job', registers: [registry],
  buckets: [0.005, 0.025, 0.1, 0.5, 1, 5],
});
// Read from SQS when Prometheus scrapes (cached for 15 seconds), so the numbers are always current.
const depthCache = { at: 0, value: {} };
new prom.Gauge({
  name: 'queue_messages',
  help: 'Messages in the jobs queue and the dead-letter queue',
  labelNames: ['queue', 'state'],
  registers: [registry],
  async collect() {
    try {
      if (Date.now() - depthCache.at > 15000) {
        const value = { jobs: await queue.depth(config.queue.url) };
        if (config.queue.dlqUrl) value.dlq = await queue.depth(config.queue.dlqUrl);
        depthCache.at = Date.now();
        depthCache.value = value;
      }
      this.reset();
      for (const [name, d] of Object.entries(depthCache.value)) {
        this.set({ queue: name, state: 'visible' }, d.visible);
        this.set({ queue: name, state: 'in_flight' }, d.inFlight);
      }
    } catch (err) {
      log.warn({ err: err.message }, 'queue_messages not collected');
    }
  },
});

// ---- the work itself ----

// task.completed: record in the task's activity feed that the worker handled it.
// Returns 'ok' or 'duplicate'. Throws on any problem so that the message is NOT deleted and comes back later.
async function handleMessage(message) {
  let job;
  try { job = JSON.parse(message.Body); } catch { throw new Error('the message body is not valid JSON'); }
  if (!job || job.type !== 'task.completed' || !Number.isInteger(job.taskId)) {
    throw new Error(`unknown or invalid job: ${String(message.Body).slice(0, 80)}`);
  }
  return tx(async (c) => {
    const first = await c.query(
      'INSERT INTO processed_jobs (message_id, type) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING message_id',
      [message.MessageId, job.type],
    );
    if (!first.rowCount) return 'duplicate'; // this message was already handled
    // task_id comes from a sub-select: if the task was deleted meanwhile it becomes NULL instead of failing
    await c.query(
      `INSERT INTO activity (task_id, task_title, kind, detail, pod)
       VALUES ((SELECT id FROM tasks WHERE id = $1), $2, 'processed', 'Completion handled by the background worker', $3)`,
      [job.taskId, String(job.title || '').slice(0, 200), config.instance.pod],
    );
    return 'ok';
  });
}

// One message: handle it, then delete it. Never throws: a failure is counted and the message stays in the queue.
async function processOne(message) {
  const timer = jobSeconds.startTimer();
  try {
    const result = await handleMessage(message);
    await queue.remove(message.ReceiptHandle);
    jobs.inc({ result });
    log.info({ messageId: message.MessageId, result }, 'job handled');
  } catch (err) {
    jobs.inc({ result: 'failed' });
    log.warn({ messageId: message.MessageId, err: err.message }, 'job failed, it will be tried again');
  } finally {
    timer();
  }
}

// ---- the loop ----

let lastPoll = Date.now();
const stopper = new AbortController();

async function pollForever() {
  let delay = 1000;
  while (!stopper.signal.aborted) {
    try {
      const messages = await queue.receive(stopper.signal);
      lastPoll = Date.now();
      delay = 1000;
      await Promise.all(messages.map(processOne));
    } catch (err) {
      if (stopper.signal.aborted) break;
      log.warn({ err: err.message, retryInMs: delay }, 'could not read the queue, retrying');
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 15000);
      lastPoll = Date.now(); // the loop is alive, the queue is not: that is a metrics problem, not a restart
    }
  }
}

function startServer() {
  const server = http.createServer(async (req, res) => {
    if (req.url === '/healthz') {
      // a long poll lasts at most waitSeconds; a loop that has not come back for much longer is stuck
      const stuck = Date.now() - lastPoll > (config.worker.waitSeconds + 60) * 1000;
      res.writeHead(stuck ? 503 : 200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status: stuck ? 'stuck' : 'ok' }));
    }
    if (req.url === '/metrics') {
      res.writeHead(200, { 'Content-Type': registry.contentType });
      return res.end(await registry.metrics());
    }
    res.writeHead(404);
    return res.end();
  });
  server.listen(config.worker.port, () => log.info({ port: config.worker.port }, 'worker listening'));
  return server;
}

async function main() {
  if (!queue.enabled) {
    log.error('QUEUE_URL is not set: nothing to do');
    process.exit(1);
  }
  const server = startServer();
  // wait for the database (the API creates the tables; migrations are idempotent, so running them here too is safe)
  for (let delay = 1000; ;) {
    try { await migrate(); break; } catch (err) {
      log.warn({ err: err.message, retryInMs: delay }, 'database not ready, retrying');
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 15000);
    }
  }
  log.info({ queue: config.queue.url }, 'worker started');

  const shutdown = (signal) => {
    log.info({ signal }, 'shutting down');
    stopper.abort(); // ends the current long poll; messages already received finish first
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  await pollForever();
  server.close();
  await pool.end();
  process.exit(0);
}

if (require.main === module) {
  main().catch((err) => { log.error({ err: err.message }, 'worker crashed'); process.exit(1); });
}

module.exports = { handleMessage };
