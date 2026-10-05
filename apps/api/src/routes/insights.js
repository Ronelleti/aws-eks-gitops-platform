const express = require('express');
const os = require('os');
const config = require('../config');
const { query, pool } = require('../db');
const s3 = require('../s3');

const router = express.Router();
const h = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const startedAt = new Date();

// Counters kept in memory, per pod. They show in the System page how requests spread over replicas.
const served = { total: 0, byClass: { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 } };
router.countRequest = (status) => {
  served.total += 1;
  const k = `${Math.floor(status / 100)}xx`;
  if (served.byClass[k] !== undefined) served.byClass[k] += 1;
};

router.get('/stats', h(async (req, res) => {
  const [status, priority, due, daily, tags, files, speed] = await Promise.all([
    query('SELECT status, count(*)::int AS n FROM tasks GROUP BY status', [], 'stats'),
    query(`SELECT priority, count(*)::int AS n FROM tasks WHERE status <> 'done' GROUP BY priority`, [], 'stats'),
    query(`SELECT
             count(*) FILTER (WHERE due_date < current_date AND status <> 'done')::int AS overdue,
             count(*) FILTER (WHERE due_date BETWEEN current_date AND current_date + 3 AND status <> 'done')::int AS due_soon
           FROM tasks`, [], 'stats'),
    query(`SELECT to_char(d, 'YYYY-MM-DD') AS day,
             (SELECT count(*)::int FROM tasks WHERE created_at::date = d::date) AS created,
             (SELECT count(*)::int FROM tasks WHERE completed_at::date = d::date) AS completed
           FROM generate_series(current_date - 13, current_date, interval '1 day') d ORDER BY d`, [], 'stats'),
    query(`SELECT tag, count(*)::int AS n FROM tasks, unnest(tags) tag GROUP BY tag ORDER BY n DESC, tag LIMIT 8`, [], 'stats'),
    query(`SELECT count(*)::int AS n, COALESCE(sum(size_bytes), 0) AS bytes FROM attachments WHERE status = 'ready'`, [], 'stats'),
    query(`SELECT avg(extract(epoch FROM (completed_at - created_at)) / 3600)::float AS hours FROM tasks WHERE completed_at IS NOT NULL`, [], 'stats'),
  ]);
  const byStatus = { todo: 0, doing: 0, done: 0 };
  status.rows.forEach((r) => { byStatus[r.status] = r.n; });
  const byPriority = { high: 0, medium: 0, low: 0 };
  priority.rows.forEach((r) => { byPriority[r.priority] = r.n; });
  res.json({
    total: byStatus.todo + byStatus.doing + byStatus.done,
    byStatus,
    openByPriority: byPriority,
    overdue: due.rows[0].overdue,
    dueSoon: due.rows[0].due_soon,
    daily: daily.rows,
    topTags: tags.rows,
    attachments: { count: files.rows[0].n, bytes: files.rows[0].bytes },
    avgCompletionHours: speed.rows[0].hours,
  });
}));

router.get('/activity', h(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
  const { rows } = await query(
    'SELECT id, task_id, task_title, kind, detail, pod, created_at FROM activity ORDER BY id DESC LIMIT $1', [limit], 'activity');
  res.json(rows);
}));

// Small and cheap: what the footer of the UI shows
router.get('/info', (req, res) => {
  res.json({
    pod: config.instance.pod,
    version: config.instance.version,
    env: config.instance.env,
    attachments: s3.enabled,
    maxUploadBytes: config.maxUploadBytes,
  });
});

// Everything about the instance that answered, for the System page
router.get('/system', h(async (req, res) => {
  const t0 = process.hrtime.bigint();
  const db = (await query(
    `SELECT current_setting('server_version') AS version, pg_database_size(current_database()) AS size,
            (SELECT max(id) FROM schema_migrations) AS schema_version`, [], 'system')).rows[0];
  const dbLatencyMs = Number(process.hrtime.bigint() - t0) / 1e6;
  const mem = process.memoryUsage();
  res.json({
    instance: { ...config.instance, hostname: os.hostname() },
    process: {
      uptimeSeconds: Math.round(process.uptime()),
      startedAt,
      node: process.version,
      rssMb: Math.round(mem.rss / 1048576),
      heapUsedMb: Math.round(mem.heapUsed / 1048576),
    },
    database: {
      ok: true,
      latencyMs: dbLatencyMs,
      version: db.version,
      sizeBytes: db.size,
      schemaVersion: db.schema_version,
      host: config.db.host,
      tls: Boolean(config.db.ssl),
      pool: { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount },
    },
    storage: await s3.bucketStatus(),
    served,
  });
}));

module.exports = router;
