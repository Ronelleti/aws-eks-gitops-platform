// Tasks API — config comes from env vars (ConfigMap + Secret in Kubernetes)
const express = require('express');
const { Pool } = require('pg');
const pino = require('pino');
const pinoHttp = require('pino-http');
const promClient = require('prom-client');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const config = {
  port: Number(process.env.PORT || 3000),
  logLevel: process.env.LOG_LEVEL || 'info',
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME || 'tasks',
    user: process.env.DB_USER || 'tasks',
    password: process.env.DB_PASSWORD,
    // RDS enforces TLS; for a lab we skip CA verification (in prod: bundle the RDS CA)
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    max: 10,
  },
  s3Bucket: process.env.S3_BUCKET || '', // empty = attachments disabled (local dev)
  awsRegion: process.env.AWS_REGION || 'us-east-1',
};

// JSON logs to stdout -> collected by Fluent Bit -> Elasticsearch
const log = pino({ level: config.logLevel });
const pool = new Pool(config.db);
// On EKS, credentials come from the pod's ServiceAccount (IRSA) — no keys in code
const s3 = config.s3Bucket ? new S3Client({ region: config.awsRegion }) : null;

// ---- Prometheus metrics ----
promClient.collectDefaultMetrics();
const httpDuration = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
});

const app = express();
app.use(express.json());
app.use(pinoHttp({ logger: log, autoLogging: { ignore: (req) => ['/healthz', '/readyz', '/metrics'].includes(req.url) } }));
app.use((req, res, next) => {
  const end = httpDuration.startTimer();
  res.on('finish', () => {
    const route = req.route ? req.baseUrl + req.route.path : 'unmatched';
    end({ method: req.method, route, status: res.statusCode });
  });
  next();
});

// wrap async handlers so errors reach the error middleware
const h = (fn) => (req, res, next) => fn(req, res).catch(next);

// ---- probes & metrics ----
app.get('/healthz', (req, res) => res.json({ status: 'ok' })); // liveness: process is up
app.get('/readyz', h(async (req, res) => { // readiness: DB reachable
  await pool.query('SELECT 1');
  res.json({ status: 'ready' });
}));
app.get('/metrics', h(async (req, res) => {
  res.set('Content-Type', promClient.register.contentType);
  res.end(await promClient.register.metrics());
}));

// ---- tasks CRUD ----
app.get('/api/tasks', h(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM tasks ORDER BY created_at DESC');
  res.json(rows);
}));

app.post('/api/tasks', h(async (req, res) => {
  const title = (req.body?.title || '').trim();
  if (!title) return res.status(400).json({ error: 'title is required' });
  const { rows } = await pool.query('INSERT INTO tasks (title) VALUES ($1) RETURNING *', [title]);
  res.status(201).json(rows[0]);
}));

app.patch('/api/tasks/:id', h(async (req, res) => {
  const { title, done } = req.body || {};
  const { rows } = await pool.query(
    `UPDATE tasks SET title = COALESCE($1, title), done = COALESCE($2, done)
     WHERE id = $3 RETURNING *`,
    [title ?? null, typeof done === 'boolean' ? done : null, req.params.id],
  );
  if (!rows.length) return res.status(404).json({ error: 'not found' });
  res.json(rows[0]);
}));

app.delete('/api/tasks/:id', h(async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM tasks WHERE id = $1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'not found' });
  res.status(204).end();
}));

// ---- attachments via S3 presigned URLs (browser uploads directly to S3) ----
const requireS3 = (req, res, next) => (s3 ? next() : res.status(501).json({ error: 'attachments disabled (S3_BUCKET not set)' }));

app.post('/api/tasks/:id/attachment', requireS3, h(async (req, res) => {
  const filename = (req.body?.filename || '').replace(/[^\w.\-]/g, '_');
  if (!filename) return res.status(400).json({ error: 'filename is required' });
  const key = `tasks/${req.params.id}/${Date.now()}-${filename}`;
  const { rowCount } = await pool.query('UPDATE tasks SET attachment_key = $1 WHERE id = $2', [key, req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'not found' });
  const uploadUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: config.s3Bucket, Key: key, ContentType: req.body?.contentType }),
    { expiresIn: 300 },
  );
  res.json({ uploadUrl, key });
}));

app.get('/api/tasks/:id/attachment', requireS3, h(async (req, res) => {
  const { rows } = await pool.query('SELECT attachment_key FROM tasks WHERE id = $1', [req.params.id]);
  if (!rows[0]?.attachment_key) return res.status(404).json({ error: 'no attachment' });
  const downloadUrl = await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: config.s3Bucket, Key: rows[0].attachment_key }),
    { expiresIn: 300 },
  );
  res.json({ downloadUrl });
}));

// ---- errors ----
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  req.log.error({ err }, 'request failed');
  res.status(500).json({ error: 'internal error' });
});

// ---- startup: wait for DB, create schema, listen ----
async function initDb() {
  for (let attempt = 1; attempt <= 15; attempt++) {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS tasks (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        done BOOLEAN NOT NULL DEFAULT false,
        attachment_key TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
      log.info('database ready');
      return;
    } catch (err) {
      log.warn({ attempt, err: err.message }, 'database not ready, retrying in 2s');
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error('database unavailable after 15 attempts');
}

async function main() {
  await initDb();
  const server = app.listen(config.port, () => log.info({ port: config.port }, 'api listening'));

  // graceful shutdown: Kubernetes sends SIGTERM before killing the pod
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
}

main().catch((err) => {
  log.fatal({ err }, 'startup failed');
  process.exit(1);
});
