// Needs no database: the middleware is tested with fake request and response objects.
const test = require('node:test');
const assert = require('node:assert/strict');
const { faultInjector } = require('../src/fault');

function run(middleware) {
  const out = { nextCalled: false, status: null, body: null };
  const res = { status(code) { out.status = code; return this; }, json(b) { out.body = b; return this; } };
  middleware({}, res, () => { out.nextCalled = true; });
  return out;
}

test('a rate of 0 (the default) never fails a request', () => {
  const mw = faultInjector(0, () => 0);
  assert.equal(run(mw).nextCalled, true);
  assert.equal(run(mw).status, null);
});

test('a missing or invalid rate is treated as off', () => {
  for (const rate of [undefined, NaN, -1]) assert.equal(run(faultInjector(rate, () => 0)).nextCalled, true);
});

test('a rate of 1 fails every request with a 500', () => {
  const out = run(faultInjector(1, () => 0.999));
  assert.equal(out.status, 500);
  assert.equal(out.nextCalled, false);
  assert.match(out.body.error, /FAULT_ERROR_RATE/);
});

test('the random draw decides: below the rate fails, at or above passes', () => {
  assert.equal(run(faultInjector(0.5, () => 0.49)).status, 500);
  assert.equal(run(faultInjector(0.5, () => 0.5)).nextCalled, true);
});

test('over a large sample about half the requests fail at a rate of 0.5', () => {
  const mw = faultInjector(0.5);
  let failed = 0;
  for (let i = 0; i < 10000; i++) if (run(mw).status === 500) failed++;
  assert.ok(failed > 4500 && failed < 5500, `failed ${failed} of 10000`);
});
