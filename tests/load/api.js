// k6 load test for the Tasks app. Run it with:  bash scripts/load-test.sh
//
// What each virtual user does, over and over: browse the board (most of the time), look at the Insights
// page, and now and then create a task, move it to "In progress" and delete it again (so the database does
// not grow). It talks to the same address a browser uses, so every request passes the UI's nginx and the API.
//
// The thresholds are the pass/fail rules. If one is broken, k6 exits with an error.
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = (__ENV.BASE_URL || 'http://localhost:8080').replace(/\/$/, '');
const VUS = Number(__ENV.VUS || 10);          // simultaneous virtual users
const DURATION = __ENV.DURATION || '2m';      // how long to hold full load

export const options = {
  stages: [
    { duration: '15s', target: VUS }, // ramp up
    { duration: DURATION, target: VUS }, // hold
    { duration: '5s', target: 0 }, // ramp down
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],     // fewer than 1% of requests may fail
    http_req_duration: ['p(95)<800'],   // 95% of requests answer within 800 ms
    checks: ['rate>0.99'],
  },
};

const JSON_HEADERS = { headers: { 'Content-Type': 'application/json' } };

function browse() {
  const list = http.get(`${BASE}/api/tasks`, { tags: { name: 'GET /api/tasks' } });
  check(list, { 'list: 200': (r) => r.status === 200 });
  const todo = http.get(`${BASE}/api/tasks?status=todo&sort=priority`, { tags: { name: 'GET /api/tasks?filter' } });
  check(todo, { 'filtered list: 200': (r) => r.status === 200 });
}

function insights() {
  const stats = http.get(`${BASE}/api/stats`, { tags: { name: 'GET /api/stats' } });
  check(stats, { 'stats: 200': (r) => r.status === 200 });
}

function createMoveDelete() {
  const title = `k6 task ${__VU}-${__ITER}`;
  const created = http.post(`${BASE}/api/tasks`, JSON.stringify({ title, priority: 'low' }), { ...JSON_HEADERS, tags: { name: 'POST /api/tasks' } });
  if (!check(created, { 'create: 201': (r) => r.status === 201 })) return;
  const id = created.json('id');
  const moved = http.patch(`${BASE}/api/tasks/${id}`, JSON.stringify({ status: 'doing' }), { ...JSON_HEADERS, tags: { name: 'PATCH /api/tasks/:id' } });
  check(moved, { 'move: 200': (r) => r.status === 200 });
  const removed = http.del(`${BASE}/api/tasks/${id}`, null, { tags: { name: 'DELETE /api/tasks/:id' } });
  check(removed, { 'delete: 2xx': (r) => r.status >= 200 && r.status < 300 });
}

export default function () {
  const roll = Math.random();
  if (roll < 0.6) browse();
  else if (roll < 0.8) insights();
  else createMoveDelete();
  sleep(0.5 + Math.random()); // a person pauses between clicks
}
