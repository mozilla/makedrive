/**
 * Cluster master process. Set child process count
 * in .env, otherwise 1 child is forked by default.
 */
var recluster = require('recluster');
var env = require('./lib/environment');
var serverPath = require('path').join(__dirname, 'server-cluster.js');

var cluster = recluster(serverPath, {
  workers: env.get('FORKS') || 1,
  readyWhen: 'ready'
});

cluster.run();
