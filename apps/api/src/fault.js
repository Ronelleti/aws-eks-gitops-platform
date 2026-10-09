// Demo-only failure injection. With FAULT_ERROR_RATE=0.5, half of the /api requests fail with HTTP 500.
// It lets you ship a deliberately broken version and watch the canary rollout stop it and roll back.
// Health probes and /metrics are not under /api, so they are never affected.
function faultInjector(rate, random = Math.random) {
  if (!(rate > 0)) return (req, res, next) => next();
  return (req, res, next) => {
    if (random() < rate) {
      return res.status(500).json({ error: 'Injected failure: FAULT_ERROR_RATE is set on this version.' });
    }
    return next();
  };
}

module.exports = { faultInjector };
