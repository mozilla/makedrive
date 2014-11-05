var env = require('./environment.js');
var messina = require('messina');
var PrettyStream = require('bunyan-prettystream');
var NODE_ENV = env.get('NODE_ENV') || 'development';

// In development, we pretty print the JSON logging to stdout.
var stream;
if(NODE_ENV === 'development') {
  stream = new PrettyStream();
  stream.pipe(process.stdout);
} else {
  stream = process.stdout;
}

var logger = messina({
  name: 'MakeDrive-' + NODE_ENV,
  stream: stream,
  level: env.get('LOG_LEVEL') || 'info',
  serializers: {
    // See lib/syncmessage.js
    syncMessage: function syncMessageSerializer(msg) {
      return {
        type: msg.type,
        name: msg.name,
        path: msg.content && msg.content.path
      };
    },
    // See server/lib/client.js
    client: function clientSerializer(client) {
      var o = {
        username: client.username,
        id: client.id,
        state: client.state,
        path: client.path
      };

      var info = client.info();
      if(info) {
        o.agent = info.agent;
        o.device = info.device !== 'Other 0.0.0' ? info.device : 'Unknown';
        o.connectedInMS = info.connectedInMS;
        o.downstreamSyncs = info.downstreamSyncs;
        o.upstreamSyncs = info.upstreamSyncs;
        o.bytesSent = info.bytesSent;
        o.bytesReceived = info.bytesReceived;
      }

      // If we are holding a lock
      if(client.lock) {
        o.lock = true;
        o.lockAge = client.lock.age;
      }

      // If we have info about when this client started syncing
      // calculate how long it has been active
      if(client._syncStarted) {
        o.currentSyncDurationInMS = Date.now() - client._syncStarted;
      }

      return o;
    },
    // See server/lib/sync-lock.js
    syncLock: function syncLockSerializer(lock) {
      return {
        // "synclock:<username>"
        username: lock.key.split(':')[1],
        id: lock.value,
        path: lock.path,
        allowLockRequest: lock.allowLockRequest,
        isUnlocked: !!lock.unlocked,
        ageInMS: lock.age
      };
    }
  }
});

module.exports = logger;
