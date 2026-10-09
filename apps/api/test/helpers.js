// Test helpers: a throwaway database, a fake S3, and the real server started as a child process.
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const { Client } = require('pg');

const DB = {
  host: process.env.TEST_DB_HOST || '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT || 5432),
  user: process.env.TEST_DB_USER || 'tasks',
  password: process.env.TEST_DB_PASSWORD || 'testpw',
};

async function withAdmin(database, fn) {
  const c = new Client({ ...DB, database });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

// A fresh empty database for each test file
async function freshDatabase(name) {
  await withAdmin('postgres', async (c) => {
    await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await c.query(`CREATE DATABASE ${name}`);
  });
  return name;
}

// Enough of S3 for path-style requests: PUT, GET, HEAD, DELETE. Signatures are not checked.
function startFakeS3(port, bucket) {
  const objects = new Map();
  const deleted = [];
  const server = http.createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    if (p === `/${bucket}` || p === `/${bucket}/`) { res.writeHead(200); return res.end(); }
    const key = p.replace(`/${bucket}/`, '');
    if (req.method === 'PUT') {
      const chunks = [];
      req.on('data', (d) => chunks.push(d));
      req.on('end', () => {
        objects.set(key, { body: Buffer.concat(chunks), type: req.headers['content-type'] });
        res.writeHead(200, { ETag: '"fake"' });
        res.end();
      });
      return undefined;
    }
    const obj = objects.get(key);
    if (req.method === 'DELETE') { objects.delete(key); deleted.push(key); res.writeHead(204); return res.end(); }
    if (!obj) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Length': obj.body.length, 'Content-Type': obj.type || 'application/octet-stream' });
    return req.method === 'HEAD' ? res.end() : res.end(obj.body);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, objects, deleted })));
}

async function startApi({ port, database, s3Port, bucket = 'test-bucket', extraEnv = {} }) {
  const env = {
    ...process.env,
    PORT: String(port),
    DB_HOST: DB.host, DB_PORT: String(DB.port), DB_USER: DB.user, DB_PASSWORD: DB.password, DB_NAME: database,
    LOG_LEVEL: 'warn',
    APP_VERSION: 'test', APP_ENV: 'test', HOSTNAME: `test-pod-${port}`,
    AWS_REGION: 'eu-north-1', AWS_ACCESS_KEY_ID: 'test', AWS_SECRET_ACCESS_KEY: 'test',
    ...(s3Port ? { S3_BUCKET: bucket, S3_ENDPOINT: `http://127.0.0.1:${s3Port}`, S3_FORCE_PATH_STYLE: 'true' } : {}),
    ...extraEnv,
  };
  const child = spawn('node', [path.join(__dirname, '..', 'src', 'index.js')], { env, stdio: ['ignore', 'inherit', 'inherit'] });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i += 1) {
    try { if ((await fetch(`${base}/readyz`)).status === 200) break; } catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 100));
    if (i === 99) { child.kill(); throw new Error('server did not become ready'); }
  }
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    return { status: res.status, json, text, headers: res.headers };
  };
  return { base, child, call, stop: () => new Promise((r) => { child.once('exit', r); child.kill('SIGTERM'); }) };
}

// Enough of SQS for the JSON protocol the SDK uses: SendMessage, ReceiveMessage, DeleteMessage, GetQueueAttributes.
// A received message stays hidden for `visibilitySeconds`, then comes back (like the real visibility timeout).
// Signatures are not checked.
function startFakeSqs(port, { visibilitySeconds = 1 } = {}) {
  const crypto = require('crypto');
  const messages = []; // { id, body, receipt, hiddenUntil, receives }
  const log = [];
  let counter = 0;
  const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (d) => chunks.push(d));
    req.on('end', async () => {
      const action = String(req.headers['x-amz-target'] || '').split('.')[1];
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
      log.push(action);
      const reply = (json) => {
        res.writeHead(200, { 'Content-Type': 'application/x-amz-json-1.0' });
        res.end(JSON.stringify(json));
      };
      if (action === 'SendMessage') {
        counter += 1;
        messages.push({ id: `msg-${counter}`, body: body.MessageBody, hiddenUntil: 0, receives: 0 });
        return reply({ MessageId: `msg-${counter}`, MD5OfMessageBody: md5(body.MessageBody) });
      }
      if (action === 'ReceiveMessage') {
        const now = Date.now();
        const out = [];
        for (const m of messages) {
          if (out.length < (body.MaxNumberOfMessages || 1) && m.hiddenUntil <= now) {
            m.hiddenUntil = now + visibilitySeconds * 1000;
            m.receives += 1;
            m.receipt = `rh-${m.id}-${m.receives}`;
            out.push({ MessageId: m.id, ReceiptHandle: m.receipt, Body: m.body, MD5OfBody: md5(m.body) });
          }
        }
        if (!out.length) await new Promise((r) => setTimeout(r, 300)); // a short "long poll"
        return reply({ Messages: out });
      }
      if (action === 'DeleteMessage') {
        const i = messages.findIndex((m) => m.receipt === body.ReceiptHandle);
        if (i >= 0) messages.splice(i, 1);
        return reply({});
      }
      if (action === 'GetQueueAttributes') {
        const now = Date.now();
        return reply({ Attributes: {
          ApproximateNumberOfMessages: String(messages.filter((m) => m.hiddenUntil <= now).length),
          ApproximateNumberOfMessagesNotVisible: String(messages.filter((m) => m.hiddenUntil > now).length),
        } });
      }
      res.writeHead(400, { 'Content-Type': 'application/x-amz-json-1.0' });
      return res.end(JSON.stringify({ __type: 'InvalidAction', message: `fake SQS does not know ${action}` }));
    });
  });
  const add = (body) => { counter += 1; messages.push({ id: `msg-${counter}`, body, hiddenUntil: 0, receives: 0 }); return `msg-${counter}`; };
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, messages, log, add })));
}

// The real worker as a child process.
async function startWorker({ port, database, sqsPort, extraEnv = {} }) {
  const env = {
    ...process.env,
    WORKER_PORT: String(port), WORKER_WAIT_SECONDS: '1',
    QUEUE_URL: `http://127.0.0.1:${sqsPort}/000000000000/jobs`, SQS_ENDPOINT: `http://127.0.0.1:${sqsPort}`,
    DB_HOST: DB.host, DB_PORT: String(DB.port), DB_USER: DB.user, DB_PASSWORD: DB.password, DB_NAME: database,
    LOG_LEVEL: 'warn', APP_VERSION: 'test', HOSTNAME: `test-worker-${port}`,
    AWS_REGION: 'eu-north-1', AWS_ACCESS_KEY_ID: 'test', AWS_SECRET_ACCESS_KEY: 'test',
    ...extraEnv,
  };
  const child = spawn('node', [path.join(__dirname, '..', 'src', 'worker.js')], { env, stdio: ['ignore', 'inherit', 'inherit'] });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i += 1) {
    try { if ((await fetch(`${base}/healthz`)).status === 200) break; } catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 100));
    if (i === 99) { child.kill(); throw new Error('worker did not start'); }
  }
  return {
    base, child,
    metrics: async () => (await fetch(`${base}/metrics`)).text(),
    stop: () => new Promise((r) => { child.once('exit', (code) => r(code)); child.kill('SIGTERM'); }),
  };
}

async function waitFor(fn, { timeoutMs = 10000, everyMs = 100 } = {}) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('waitFor: timed out');
    await new Promise((r) => setTimeout(r, everyMs));
  }
}

module.exports = { DB, withAdmin, freshDatabase, startFakeS3, startFakeSqs, startWorker, waitFor, startApi };
