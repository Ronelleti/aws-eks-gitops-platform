// One JSON object per line on stdout. Fluent Bit ships these to Elasticsearch, so every line
// carries the pod and version to filter on.
const pino = require('pino');
const config = require('./config');

module.exports = pino({
  level: config.logLevel,
  base: { app: 'tasks-api', pod: config.instance.pod, version: config.instance.version },
  timestamp: pino.stdTimeFunctions.isoTime,
});
