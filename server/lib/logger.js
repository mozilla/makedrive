var env = require('./environment.js');
var ClientInfo = require('./client-info.js');
var messina = require('messina'); 

var logger = messina({
  name: 'MakeDrive-' + (env.get('NODE_ENV') || 'development'),
  serializers: {
    // See lib/syncmessage.js
    syncMessage: function syncMessageSerializer(msg) {
      return {
        type: msg.type,
        name: msg.name
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

      var info = ClientInfo.find(client);
      if(info) {
        o.agent = info.agent;
        o.device = info.device !== 'Other 0.0.0' ? info.device : 'Unknown';
        o.connectedInMS = info.connectedInMS;
        o.downstreamSyncs = info.downstreamSyncs;
        o.upstreamSyncs = info.upstreamSyncs;
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
        allowLockRequest: lock.allowLockRequest,
        isUnlocked: !!lock.unlocked,
        ageInMS: lock.age
      };
    }
  }
});

// Figure out which log level to use. This can be set
// via command env variables or in .env. Use 'debug'
// for useful development logs.
logger.level(env.get('LOG_LEVEL') || 'info');

module.exports = logger;
