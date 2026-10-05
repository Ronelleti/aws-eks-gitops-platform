const express = require('express');
const config = require('../config');
const { query } = require('../db');
const metrics = require('../metrics');
const s3 = require('../s3');
const { HttpError, parseId } = require('../validate');

const router = express.Router();
const h = (fn) => (req, res, next) => fn(req, res, next).catch(next);

const requireS3 = (req, res, next) =>
  s3.enabled ? next() : next(new HttpError(501, 'Attachments are off: no S3 bucket is configured.'));

const safeName = (name) => String(name || '').replace(/[^\w.\- ]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120);

async function logActivity({ taskId, title, kind, detail }) {
  await query('INSERT INTO activity (task_id, task_title, kind, detail, pod) VALUES ($1, $2, $3, $4, $5)',
    [taskId, title, kind, detail, config.instance.pod], 'activity');
}

// Step 1: ask for permission to upload. The browser then PUTs the file straight to S3.
router.post('/tasks/:id/attachments', requireS3, h(async (req, res) => {
  const taskId = parseId(req.params.id);
  const filename = safeName(req.body?.filename);
  const contentType = String(req.body?.contentType || 'application/octet-stream').slice(0, 100);
  const size = Number(req.body?.size || 0);
  if (!filename) throw new HttpError(400, 'Some fields need attention.', { filename: 'A file name is required.' });
  if (size > config.maxUploadBytes) {
    throw new HttpError(413, `That file is too large. The limit is ${Math.round(config.maxUploadBytes / 1048576)} MB.`);
  }
  const task = (await query('SELECT id FROM tasks WHERE id = $1', [taskId], 'attach')).rows[0];
  if (!task) throw new HttpError(404, 'Task not found.');

  const key = `tasks/${taskId}/${Date.now()}-${filename}`;
  const { rows } = await query(
    `INSERT INTO attachments (task_id, s3_key, filename, content_type, size_bytes) VALUES ($1, $2, $3, $4, $5)
     RETURNING id, filename, content_type, size_bytes, status`,
    [taskId, key, filename, contentType, size], 'attach');
  const uploadUrl = await s3.presignUpload(key, contentType);
  res.status(201).json({ attachment: rows[0], uploadUrl });
}));

// Step 2: the browser reports that the upload finished. We check that the object is really there.
router.post('/attachments/:id/confirm', requireS3, h(async (req, res) => {
  const id = parseId(req.params.id);
  const att = (await query(`SELECT a.*, t.title FROM attachments a JOIN tasks t ON t.id = a.task_id WHERE a.id = $1`, [id], 'attach')).rows[0];
  if (!att) throw new HttpError(404, 'Attachment not found.');
  let size;
  try {
    ({ size } = await s3.headObject(att.s3_key));
  } catch {
    throw new HttpError(409, 'The file did not arrive in storage. Try uploading it again.');
  }
  await query(`UPDATE attachments SET status = 'ready', size_bytes = $2 WHERE id = $1`, [id, size], 'attach');
  await logActivity({ taskId: att.task_id, title: att.title, kind: 'attached', detail: att.filename });
  metrics.attachmentsUploaded.inc();
  res.json({ id, filename: att.filename, content_type: att.content_type, size_bytes: size, status: 'ready' });
}));

// A short-lived link to view or download the file (?inline=1 lets the browser show images in place).
router.get('/attachments/:id/download', requireS3, h(async (req, res) => {
  const id = parseId(req.params.id);
  const att = (await query(`SELECT * FROM attachments WHERE id = $1 AND status = 'ready'`, [id], 'attach')).rows[0];
  if (!att) throw new HttpError(404, 'Attachment not found.');
  res.json({ url: await s3.presignDownload(att.s3_key, att.filename, req.query.inline === '1'), filename: att.filename });
}));

router.delete('/attachments/:id', h(async (req, res) => {
  const id = parseId(req.params.id);
  const att = (await query(
    `DELETE FROM attachments a USING tasks t WHERE a.id = $1 AND t.id = a.task_id RETURNING a.s3_key, a.filename, a.task_id, t.title`, [id], 'attach')).rows[0];
  if (!att) throw new HttpError(404, 'Attachment not found.');
  await s3.deleteObjects([att.s3_key]);
  await logActivity({ taskId: att.task_id, title: att.title, kind: 'detached', detail: att.filename });
  res.status(204).end();
}));

module.exports = router;
