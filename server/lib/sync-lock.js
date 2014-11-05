/**
 * Distributed sync lock using redis. Our lock is designed to allow a user's
 * filesystem to be synced, but only by one client (i.e., id) at a time. A
 * remote client can request the lock, and then hold it as long as is necessary.
 * Other clients can request the lock during that time, and depending on the value
 * of lock.allowLockRequest, the client holding the lock will either retain it
 * or give it up, setting it for the new client. The communication between clients
 * is done via redis pub/sub and keys. We don't timeout keys in redis directly, but
 * do rely on a timeout when a client requests the lock (pub/sub) and doesn't hear
 * back from the client holding the lock--in case it crashed or otherwise can't
 * reply.
 */
var redis = require('../redis-clients.js');
var Constants = require('../../lib/constants.js');
var EventEmitter = require('events').EventEmitter;
var util = require('util');
var env = require('../../server/lib/environment');
var CLIENT_TIMEOUT_MS = env.get('CLIENT_TIMEOUT_MS') || 5000;
var log = require('./logger.js');

function handleLockRequest(message, lock) {
  try {
    message = JSON.parse(message);
  } catch(err) {
    log.error({syncLock: lock, err: err}, 'Could not parse lock request message from redis: `%s`', message);
    return;
  }

  // Not meant for this lock, skip
  if(lock.key !== message.key || lock.path !== message.path) {
    return;
  }

  // If the owner thinks this lock is not yet unlockable, respond as such
  if(!lock.allowLockRequest) {
    log.debug({syncLock: lock}, 'Denying lock override request for client id=%s.', message.id);
    redis.publish(Constants.server.lockResponseChannel, JSON.stringify({key: lock.key, path: lock.path, unlocked: false}));
    return;
  }

  // Otherwise, give up the lock by overwriting the value with the
  // requesting client's ID (replacing ours), and respond that we've released it.
  redis.hset(lock.key, lock.path, message.id, function(err, reply) {
    if(err) {
      log.error({err: err, syncLock: lock}, 'Error setting redis lock key.');
      return;
    }

    if(reply !== 'OK') {
      log.error({syncLock: lock}, 'Error setting redis lock key, expected OK reply, got %s.', reply);
      return;
    }

    log.debug({syncLock: lock}, 'Allowing lock override request for id=%s.', message.id);
    lock.unlocked = true;
    lock.emit('unlocked');
    redis.publish(Constants.server.lockResponseChannel, JSON.stringify({key: lock.key, path: lock.path, unlocked: true}));
  });
}

function SyncLock(key, id, path) {
  EventEmitter.call(this);

  this.key = key;
  this.value = id;
  this.path = path;

  // Listen for requests to release this lock early.
  var lock = this;
  lock._handleLockRequestFn = function(message) {
    handleLockRequest(message, lock);
  };
  redis.on('lock-request', lock._handleLockRequestFn);

  // By default, deny lock requests. Users of this lock
  // can override this if the lock is releasable early.
  this.allowLockRequest = false;

  // Keep track of how long (ms) this lock has been alive (mostly for logging).
  // We return 0 if the lock is unlocked.
  var born = Date.now();
  var self = this;
  Object.defineProperty(this, 'age', {
    get: function() {
      if(self.unlocked) {
        return 0;
      }
      return Date.now() - born;
    }
  });
}
util.inherits(SyncLock, EventEmitter);

SyncLock.generateKey = function(username) {
  return 'synclock:' + username;
};

SyncLock.prototype.release = function(callback) {
  var lock = this;
  var key = lock.key;
  var path = lock.path;

  // Stop listening for requests to release this lock
  redis.removeListener('lock-request', lock._handleLockRequestFn);
  lock._handleLockRequestFn = null;

  // Try to delete the lock in redis
  redis.hdel(key, path, function(err, reply) {
    // NOTE: we don't emit the unlocked event here, but use the callback instead.
    // The unlocked event indicates that the lock was released without calling release().
    lock.unlocked = true;

    if(err) {
      log.error({err: err, syncLock: lock}, 'Error releasing lock (redis.del).');
      return callback(err);
    }

    log.debug({syncLock: lock}, 'Lock released.');
    callback(null, reply === 'OK');
  });
};

function handleLockResponse(message, key, path, client, waitTimer, callback) {
  var id = client.id;

  try {
    message = JSON.parse(message);
  } catch(err) {
    log.error(err, 'Could not parse lock response message from redis: `%s`', message);
    return callback(err);
  }

  // Not meant for this lock, skip
  if(key !== message.key || path !== message.path) {
    return;
  }

  // Stop the timer from expiring, since we got a response in time.
  clearTimeout(waitTimer);

  redis.removeListener('lock-response', client._handleLockResponseFn);
  client._handleLockResponseFn = null;

  // The result of the request is defined in the `unlocked` param,
  // which is true if we now hold the lock, false if not.
  if(message.unlocked) {
    var lock = new SyncLock(key, id, path);
    log.debug({syncLock: lock}, 'Lock override acquired.');
    callback(null, lock);
  } else {
    log.debug('Lock override denied for %s in key %s.', path, key);
    callback();
  }
}

/**
 * Request a lock for the current client.
 */
function request(client, path, callback) {
  var key = SyncLock.generateKey(client.username);
  var id = client.id;

  // Try to set this key/value pair, but fail if the path for the key already exists.
  redis.hsetnx(key, path, id, function(err, reply) {
    if(err) {
      log.error({err: err, client: client}, 'Error trying to set redis key with hsetnx');
      return callback(err);
    }

    if(reply === 1) {
      // Success, we have the lock (path for the key was set). Return a new SyncLock instance
      var lock = new SyncLock(key, id, path);
      log.debug({client: client, syncLock: lock}, 'Lock acquired.');
      return callback(null, lock);
    }

    // Path for key was not set (held by another client). See if the lock owner would be
    // willing to let us take it. We'll wait a bit for a reply, and if
    // we don't get one, assume the client holding the lock, or its server,
    // has crashed, and the lock is OK to take.

    // Act if we don't hear back from the lock owner in a reasonable
    // amount of time, and set the lock ourselves.
    var waitTimer = setTimeout(function() {
      redis.removeListener('lock-response', client._handleLockResponseFn);
      client._handleLockResponseFn = null;

      redis.hset(key, path, id, function(err) {
        if(err) {
          log.error({err: err, client: client}, 'Error setting redis lock key.');
          return callback(err);
        }

        var lock = new SyncLock(key, id, path);
        log.debug({client: client, syncLock: lock}, 'Lock request timeout, setting lock manually.');
        callback(null, lock);
      });
    }, CLIENT_TIMEOUT_MS);
    waitTimer.unref();

    // Listen for a response from the client holding the lock
    client._handleLockResponseFn = function(message) {
      handleLockResponse(message, key, path, client, waitTimer, callback);
    };
    redis.on('lock-response', client._handleLockResponseFn);

    // Ask the client holding the lock to give it to us
    log.debug({client: client}, 'Requesting lock override for ' + path);
    redis.publish(Constants.server.lockRequestChannel, JSON.stringify({key: key, id: id, path: path}));
  });
}

/**
 * Check to see if a lock is held for the given username.
 */
function isUserLocked(username, path, callback) {
  var key = SyncLock.generateKey(username);
  redis.hget(key, path, function(err, value) {
    if(err) {
      log.error(err, 'Error getting redis lock key %s.', key);
      return callback(err);
    }

    callback(null, !!value);
  });
}

module.exports = {
  request: request,
  isUserLocked: isUserLocked
};
