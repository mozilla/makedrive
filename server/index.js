if (process.env.NEW_RELIC_ENABLED) {
  require('newrelic');
}

var recluster = require('recluster');
var env = require('./lib/environment');
var serverPath = require('path').join(__dirname, 'server.js');

var cluster = recluster(serverPath, {
  workers: env.get('FORKS', 1),
  readyWhen: 'listening'
});
cluster.run();
