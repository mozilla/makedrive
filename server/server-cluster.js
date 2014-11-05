var server = require('./server.js');
var cluster = require('cluster');
var log = require('./lib/logger.js');

server.once('shutdown', function(err) {
  if(err) {
    log.error(err, 'Unable to complete clean shutdown process');
  }

  if (cluster.worker) {
    cluster.worker.disconnect();
  }

  log.fatal('Killing server process');
  process.exit(1);
});

server.start(function() {
  process.send({cmd: 'ready'});
  log.info('Started Server Worker.');
});
