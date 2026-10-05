// Tasks API: tasks, attachments, insights and system information.
const express = require('express');
const pinoHttp = require('pino-http');
const crypto = require('crypto');
const config = require('./config');
const log = require('./log');
const metrics = require('./metrics');
const { pool, query } = require('./db');
const { migrate } = require('./migrations');
const { HttpError } = require('./validate');
const tasks = require('./routes/tasks');
const attachments = require('./routes/attachments');
const insights = require('./routes/insights');
const demo = require('./routes/demo');

let schemaReady = false; // set once migrations have run

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));

app.use(pinoHttp({
  logger: log,
  genReqId: (req) => req.headers['x-request-id'] || crypto.randomUUID(),
  autoLogging: { ignore: (req) => ['/healthz', '/readyz', '/metrics'].includes(req.url) },
  // short, searchable access logs (the default would dump every header)
  serializers: {
    req: (req) => ({ id: req.id, method: req.method, url: req.url }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
}));

app.use((req, res, next) => {
  res.setHeader('X-Request-Id', req.id);
  res.setHeader('X-Served-By', config.instance.pod);
  const end = metrics.httpDuration.startTimer();
  res.on('finish', () => {
    const route = req.route ? req.baseUrl + req.route.path : 'unmatched';
    end({ method: req.method, route, status: res.statusCode });
    if (req.url.startsWith('/api/')) insights.countRequest(res.statusCode);
  });
  next();
});

// Probes. Liveness NEVER depends on the database: a database outage must not restart every API pod.
app.get('/healthz', (req, res) => res.json({ status: 'ok' }));
app.get('/readyz', async (req, res) => {
  try {
    if (!schemaReady) throw new Error('schema not initialized yet');
    await query('SELECT 1', [], 'ready');
    res.json({ status: 'ready' });
  } catch (err) {
    res.status(503).json({ status: 'not ready', reason: err.message });
  }
});
app.get('/metrics', async (req, res, next) => {
  try {
    res.set('Content-Type', metrics.client.register.contentType);
    res.end(await metrics.client.register.metrics());
  } catch (err) { next(err); }
});

app.use('/api/tasks', tasks);
app.use('/api', attachments);
app.use('/api', insights);
app.use('/api/demo', demo);
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, fields: err.fields });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'The request body is not valid JSON.' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'The request body is too large.' });
  req.log.error({ err: err.message, stack: err.stack }, 'request failed');
  return res.status(500).json({ error: 'Something went wrong on our side. Try again in a moment.' });
});

// Startup: listen first (so liveness passes while the database is down), then wait for the database.
async function initDb() {
  let delay = 1000;
  for (;;) {
    try {
      const version = await migrate();
      schemaReady = true;
      log.info({ schemaVersion: version }, 'database ready');
      return;
    } catch (err) {
      log.warn({ err: err.message, retryInMs: delay }, 'database not ready, retrying');
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 15000); // exponential backoff, at most 15 seconds
    }
  }
}

const server = app.listen(config.port, () => log.info({ port: config.port }, 'api listening'));
initDb();

// Kubernetes sends SIGTERM before it stops a pod
const shutdown = (signal) => {
  log.info({ signal }, 'shutting down');
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
