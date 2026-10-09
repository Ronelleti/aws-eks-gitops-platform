// All configuration comes from environment variables (a ConfigMap and a Secret on Kubernetes).
const os = require('os');

const num = (value, fallback) => (value === undefined || value === '' ? fallback : Number(value));

module.exports = {
  port: num(process.env.PORT, 3000),
  logLevel: process.env.LOG_LEVEL || 'info',

  db: {
    host: process.env.DB_HOST || 'localhost',
    port: num(process.env.DB_PORT, 5432),
    database: process.env.DB_NAME || 'tasks',
    user: process.env.DB_USER || 'tasks',
    password: process.env.DB_PASSWORD,
    // RDS enforces TLS. For a lab we skip CA verification (in production: bundle the RDS CA).
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    max: num(process.env.DB_POOL_MAX, 10),
  },

  s3: {
    bucket: process.env.S3_BUCKET || '', // empty = attachments disabled (plain local dev)
    region: process.env.AWS_REGION || 'us-east-1',
    // Only for tests and local S3 clones. On AWS leave both unset: credentials come from Pod Identity.
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  },

  // Background jobs (SQS). Empty QUEUE_URL = no queue: the API skips enqueueing and the worker will not start.
  queue: {
    url: process.env.QUEUE_URL || '',
    dlqUrl: process.env.DLQ_URL || '', // only read for the queue-depth metrics
    region: process.env.AWS_REGION || 'us-east-1',
    // Only for tests and local SQS clones. On AWS leave unset: credentials come from Pod Identity.
    endpoint: process.env.SQS_ENDPOINT || undefined,
  },
  worker: {
    port: num(process.env.WORKER_PORT, 9100), // /healthz and /metrics
    waitSeconds: num(process.env.WORKER_WAIT_SECONDS, 20), // SQS long polling
  },

  maxUploadBytes: num(process.env.MAX_UPLOAD_BYTES, 10 * 1024 * 1024),
  enableDemo: process.env.ENABLE_DEMO !== 'false', // POST /api/demo/seed

  // Demo only: answer this share of /api requests (0 to 1) with HTTP 500. It exists to show a canary
  // rollout being stopped and rolled back automatically. Leave it at 0 in normal use.
  faultErrorRate: Math.min(1, Math.max(0, num(process.env.FAULT_ERROR_RATE, 0) || 0)),

  // Who is answering. The UI shows this, and every log line carries it.
  instance: {
    pod: process.env.HOSTNAME || os.hostname(),
    node: process.env.NODE_NAME || '', // set from the Kubernetes downward API
    namespace: process.env.POD_NAMESPACE || '',
    version: process.env.APP_VERSION || 'dev',
    env: process.env.APP_ENV || 'local',
    region: process.env.AWS_REGION || '',
  },
};
