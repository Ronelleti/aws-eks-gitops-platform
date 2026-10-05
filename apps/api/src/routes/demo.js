const express = require('express');
const config = require('../config');
const { tx } = require('../db');
const metrics = require('../metrics');
const { HttpError } = require('../validate');

const router = express.Router();
const h = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// day offsets are relative to today, so the charts always look alive
const SAMPLE = [
  ['Write the runbook for restoring the database', 'high', 'doing', 2, ['ops', 'docs'], null],
  ['Rotate the CI access key', 'high', 'todo', 5, ['security'], null],
  ['Add an alert for 5xx errors above 5%', 'medium', 'todo', 7, ['monitoring'], null],
  ['Review the Terraform plan for the VPC change', 'medium', 'doing', 1, ['terraform'], null],
  ['Tune HPA targets after the load test', 'low', 'todo', 14, ['kubernetes'], null],
  ['Move Kibana dashboards into Git', 'low', 'todo', null, ['logging'], null],
  ['Fix the flaky readiness probe', 'high', 'todo', -2, ['kubernetes', 'bug'], null],
  ['Upgrade the base image to the latest nginx', 'medium', 'done', null, ['security'], 1],
  ['Enable network policies on EKS', 'high', 'done', null, ['kubernetes', 'security'], 2],
  ['Create the S3 bucket for attachments', 'medium', 'done', null, ['aws'], 3],
  ['Pin Helm chart versions', 'low', 'done', null, ['gitops'], 5],
  ['Switch the database password to RDS-managed', 'high', 'done', null, ['aws', 'security'], 6],
  ['Write the README', 'medium', 'done', null, ['docs'], 8],
  ['Add the security gate to CI', 'high', 'done', null, ['ci', 'security'], 9],
];

router.post('/seed', h(async (req, res) => {
  if (!config.enableDemo) throw new HttpError(404, 'Not found.');
  const created = await tx(async (c) => {
    const existing = (await c.query('SELECT count(*)::int AS n FROM tasks')).rows[0].n;
    if (existing > 0 && req.query.force !== '1') throw new HttpError(409, 'There are already tasks. Delete them first, or add ?force=1.');
    let n = 0;
    for (const [title, priority, status, due, tags, doneDaysAgo] of SAMPLE) {
      const { rows } = await c.query(
        `INSERT INTO tasks (title, priority, status, done, due_date, tags, created_at, completed_at, updated_at)
         VALUES ($1, $2, $3, $4::boolean,
                 CASE WHEN $5::int IS NULL THEN NULL ELSE current_date + $5::int END,
                 $6, now() - (COALESCE($7::int, 0) + 3 || ' days')::interval,
                 CASE WHEN $7::int IS NULL THEN NULL ELSE now() - ($7::int || ' days')::interval END, now())
         RETURNING id`,
        [title, priority, status, status === 'done', due, tags, doneDaysAgo]);
      await c.query('INSERT INTO activity (task_id, task_title, kind, detail, pod) VALUES ($1, $2, $3, $4, $5)',
        [rows[0].id, title, 'created', 'Sample data', config.instance.pod]);
      n += 1;
    }
    return n;
  });
  for (let i = 0; i < created; i += 1) metrics.tasksCreated.inc();
  res.status(201).json({ created });
}));

module.exports = router;
