var bunyan = require('bunyan');
var env = require('./environment.js');

var logger = bunyan.createLogger({
  name: 'MakeDrive',
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
      return {
        username: client.username,
        id: client.id,
        state: client.state,
        path: client.path
      };
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
