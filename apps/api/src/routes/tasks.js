const express = require('express');
const config = require('../config');
const { query, tx } = require('../db');
const metrics = require('../metrics');
const s3 = require('../s3');
const queue = require('../queue');
const { HttpError, parseTaskInput, parseId, failIfInvalid } = require('../validate');

const router = express.Router();
const h = (fn) => (req, res, next) => fn(req, res, next).catch(next); // async errors reach the error handler

const LABEL = { todo: 'To do', doing: 'In progress', done: 'Done' };

async function logActivity(db, { taskId, title, kind, detail = '' }) {
  await db.query(
    'INSERT INTO activity (task_id, task_title, kind, detail, pod) VALUES ($1, $2, $3, $4, $5)',
    [taskId, title, kind, detail, config.instance.pod],
  );
}

const withCount = `(SELECT count(*)::int FROM attachments a WHERE a.task_id = t.id AND a.status = 'ready') AS attachment_count`;

// GET /api/tasks?q=&status=&priority=&tag=&overdue=1&sort=created|due|priority|updated
router.get('/', h(async (req, res) => {
  const where = [];
  const params = [];
  const add = (sql, v) => { params.push(v); where.push(sql.replace(/\?/g, `$${params.length}`)); };

  if (req.query.q) add('(t.title ILIKE ? OR t.notes ILIKE ?)', `%${String(req.query.q).slice(0, 100)}%`);
  if (req.query.status) add('t.status = ?', String(req.query.status));
  if (req.query.priority) add('t.priority = ?', String(req.query.priority));
  if (req.query.tag) add('? = ANY(t.tags)', String(req.query.tag).toLowerCase());
  if (req.query.overdue === '1') where.push(`t.due_date < current_date AND t.status <> 'done'`);

  const orders = {
    created: 't.created_at DESC',
    updated: 't.updated_at DESC',
    due: 't.due_date ASC NULLS LAST, t.created_at DESC',
    priority: `CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, t.created_at DESC`,
  };
  const order = orders[req.query.sort] || orders.created;

  const sql = `SELECT t.*, ${withCount} FROM tasks t ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${order} LIMIT 500`;
  const { rows } = await query(sql, params, 'list');
  res.json(rows);
}));

router.post('/', h(async (req, res) => {
  const { value, errors } = parseTaskInput(req.body, { partial: false });
  failIfInvalid(errors);
  const task = await tx(async (c) => {
    const { rows } = await c.query(
      `INSERT INTO tasks (title, notes, priority, status, due_date, tags, done, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $4::text = 'done' THEN now() END)
       RETURNING *`,
      [value.title, value.notes || '', value.priority || 'medium', value.status || 'todo', value.due_date || null, value.tags || [], value.status === 'done'],
    );
    await logActivity(c, { taskId: rows[0].id, title: rows[0].title, kind: 'created' });
    return rows[0];
  });
  metrics.tasksCreated.inc();
  res.status(201).json({ ...task, attachment_count: 0 });
}));

router.get('/:id', h(async (req, res) => {
  const id = parseId(req.params.id);
  const { rows } = await query(`SELECT t.*, ${withCount} FROM tasks t WHERE t.id = $1`, [id], 'get');
  if (!rows.length) throw new HttpError(404, 'Task not found.');
  const [attachments, activity] = await Promise.all([
    query(`SELECT id, filename, content_type, size_bytes, created_at FROM attachments WHERE task_id = $1 AND status = 'ready' ORDER BY id`, [id], 'get'),
    query('SELECT id, kind, detail, pod, created_at FROM activity WHERE task_id = $1 ORDER BY id DESC LIMIT 30', [id], 'get'),
  ]);
  res.json({ ...rows[0], attachments: attachments.rows, activity: activity.rows });
}));

router.patch('/:id', h(async (req, res) => {
  const id = parseId(req.params.id);
  const { value, errors } = parseTaskInput(req.body, { partial: true });
  failIfInvalid(errors);
  // the first version of the UI sent { done: true/false }
  if (value.status === undefined && typeof req.body?.done === 'boolean') value.status = req.body.done ? 'done' : 'todo';

  const result = await tx(async (c) => {
    const cur = (await c.query('SELECT * FROM tasks WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!cur) return null;

    const sets = [];
    const params = [];
    const changed = [];
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    for (const col of ['title', 'notes', 'priority', 'due_date', 'tags']) {
      if (value[col] !== undefined && !same(value[col], cur[col])) {
        params.push(value[col]);
        sets.push(`${col} = $${params.length}`);
        changed.push(col === 'due_date' ? 'due date' : col);
      }
    }
    let moved = null;
    if (value.status !== undefined && value.status !== cur.status) {
      moved = { from: cur.status, to: value.status };
      params.push(value.status);
      // done is derived from the NEW value ($n). Writing (status = 'done') here would read the OLD row.
      sets.push(`status = $${params.length}`, `done = ($${params.length}::text = 'done')`);
      sets.push(value.status === 'done' ? 'completed_at = now()' : 'completed_at = NULL');
    }
    if (!sets.length) return { task: cur, none: true };

    params.push(id);
    const { rows } = await c.query(
      `UPDATE tasks SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length} RETURNING *`,
      params,
    );
    const task = rows[0];
    if (moved) await logActivity(c, { taskId: id, title: task.title, kind: 'moved', detail: `${LABEL[moved.from]} to ${LABEL[moved.to]}` });
    if (changed.length) await logActivity(c, { taskId: id, title: task.title, kind: 'edited', detail: `Changed ${changed.join(', ')}` });
    return { task, moved };
  });

  if (!result) throw new HttpError(404, 'Task not found.');
  if (result.moved && result.moved.to === 'done') {
    metrics.tasksCompleted.inc();
    // hand the follow-up work to the background worker (a quick, best-effort send: the task is already saved)
    if (queue.enabled) {
      const queued = await queue.sendJob({ type: 'task.completed', taskId: id, title: result.task.title, requestId: req.id });
      metrics.jobsEnqueued.inc({ result: queued ? 'queued' : 'failed' });
    }
  }
  const { rows } = await query(`SELECT t.*, ${withCount} FROM tasks t WHERE t.id = $1`, [id], 'get');
  res.json(rows[0]);
}));

router.delete('/:id', h(async (req, res) => {
  const id = parseId(req.params.id);
  const keys = await tx(async (c) => {
    const cur = (await c.query('SELECT id, title FROM tasks WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!cur) return null;
    const files = (await c.query('SELECT s3_key FROM attachments WHERE task_id = $1', [id])).rows.map((r) => r.s3_key);
    await c.query('DELETE FROM tasks WHERE id = $1', [id]); // attachments rows go with it (ON DELETE CASCADE)
    await logActivity(c, { taskId: null, title: cur.title, kind: 'deleted' });
    return files;
  });
  if (keys === null) throw new HttpError(404, 'Task not found.');
  await s3.deleteObjects(keys);
  res.status(204).end();
}));

module.exports = router;
