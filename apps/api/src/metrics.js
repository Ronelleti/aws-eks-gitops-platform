// Prometheus metrics, served on /metrics.
const client = require('prom-client');
const log = require('./log');

client.collectDefaultMetrics();

const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
});

const dbDuration = new client.Histogram({
  name: 'db_query_duration_seconds',
  help: 'Database query duration in seconds',
  labelNames: ['op'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
});

const tasksCreated = new client.Counter({ name: 'tasks_created_total', help: 'Tasks created' });
const tasksCompleted = new client.Counter({ name: 'tasks_completed_total', help: 'Tasks moved to done' });
const attachmentsUploaded = new client.Counter({ name: 'attachments_uploaded_total', help: 'Attachments uploaded' });

// The two gauges below are read from the database at scrape time, so they are always current.
new client.Gauge({
  name: 'tasks_by_status',
  help: 'Tasks currently in each status',
  labelNames: ['status'],
  async collect() {
    try {
      const { query } = require('./db'); // loaded lazily: db.js requires this file
      const { rows } = await query('SELECT status, count(*)::int AS n FROM tasks GROUP BY status', [], 'metrics');
      this.reset();
      for (const s of ['todo', 'doing', 'done']) this.set({ status: s }, 0);
      for (const r of rows) this.set({ status: r.status }, r.n);
    } catch (err) {
      log.warn({ err: err.message }, 'tasks_by_status not collected');
    }
  },
});

new client.Gauge({
  name: 'db_pool_connections',
  help: 'Database pool connections by state',
  labelNames: ['state'],
  collect() {
    const { pool } = require('./db');
    this.set({ state: 'total' }, pool.totalCount);
    this.set({ state: 'idle' }, pool.idleCount);
    this.set({ state: 'waiting' }, pool.waitingCount);
  },
});

module.exports = { client, httpDuration, dbDuration, tasksCreated, tasksCompleted, attachmentsUploaded };
