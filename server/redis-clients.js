/**
 * Redis client connection manager. We create and use
 * three separate clients:
 *
 *   1) store to read/write data
 *   2) pub to publish data on a channel
 *   3) sub to subscribe to data on a channel
 *
 * The REDIS_URL comes from .env.
 *
 * Callers should use the methods exposed on module.exports.
 */
var EventEmitter = require('events').EventEmitter;
var url = require('url');
var redis = require('redis');
var env = require('./lib/environment.js');
var Constants = require('../lib/constants.js');
var log = require('./lib/logger.js');

// Internal-only client for working with keys
var store;
// Internal-only dedicated pub/sub clients.
// Users should listen for 'message' events,
// and call publish() on the module.
var pub;
var sub;

var ignoreEndEvents;

module.exports = new EventEmitter();

// Deal with the fact that we're going to have a lot of listeners on this emitter
// see http://nodejs.org/api/events.html#events_emitter_setmaxlisteners_n
// TODO: what is a useful limit?  Is unlimited (i.e., 0) OK?
module.exports.setMaxListeners(0);

function onerror(err) {
  // Let top-level server deal with this error
  log.error(err, 'Redis error');
  module.exports.emit('error', err);
}

function onend() {
  // Redis server connection lost.
  if(ignoreEndEvents) {
    return;
  }

  // TODO: we need a way to not need to error when we lose the single
  // redis instance (e.g., proxy/cluster setup for redis). For now
  // we have a single-point-of-failure, and have to bail.
  onerror(new Error('Redis server hung-up'));
}

// redis subscription messages
function onmessage(channel, message) {
  module.exports.emit('message', channel, message);
}

function createClient(callback) {
  var client;

  try {
    var redisUrl = url.parse(env.get('REDIS_URL', ''));

    // Depending on the format of the host, we may not get a proper hostname (e.g.,
    // 'localhost' vs. 'http://localhost'. Assume localhost if missing.
    redisUrl.hostname = redisUrl.hostname || 'localhost';
    redisUrl.port = redisUrl.port || 6379;
    redisUrl.password = redisUrl.auth ? redisUrl.auth.split(':')[1] : null;

    client = redis.createClient(redisUrl.port, redisUrl.hostname);

    // Caller needs to figure out what to do with errors, hang-ups.
    client.on('error', onerror);
    client.on('end', onend);
    client.on('ready', function() {
      if(redisUrl.password) {
        client.auth(redisUrl.password);
      }

      log.info('Connected to redis hostname=%s port=%s', redisUrl.hostname, redisUrl.port);
      callback(null, client);
    });
  } catch(err) {
    log.error(err, 'Error connecting to redis hostname=%s port=%s', redisUrl.hostname, redisUrl.port);
    callback(err);
  }
}

module.exports.start = function(callback) {
  if(store && pub && sub) {
    // Already started
    log.warn('RedisClients.start() called while already connected.');
    return callback();
  }

  ignoreEndEvents = false;

  createClient(function(err, storeClient) {
    if(err) return callback(err);

    store = storeClient;

    createClient(function(err, pubClient) {
      if(err) return callback(err);

      pub = pubClient;

      createClient(function(err, subClient) {
        if(err) return callback(err);

        sub = subClient;

        // Subscribe to the channels we care about
        sub.on('message', onmessage);
        sub.subscribe(Constants.server.syncChannel);
        sub.subscribe(Constants.server.lockRequestChannel);
        sub.subscribe(Constants.server.lockResponseChannel);

        callback();
      });
    });
  });
};

module.exports.close = function(callback) {
  if(!(store && sub && pub)) {
    // Already closed
    log.warn('RedisClients.close() called while already closed.');
    return callback();
  }

  // While we're closing, don't worry about hang-ups from server
  ignoreEndEvents = true;

  store.quit(function() {
    store = null;

    pub.quit(function() {
      pub = null;

      sub.quit(function() {
        sub = null;

        callback();
      });
    });
  });
};

// NOTE: start() must be called before the following methods will be available.
module.exports.publish = function(channel, message) {
  if(!pub) {
    log.error('Called redis.publish() before start()');
    return;
  }

  pub.publish(channel, message);
};

module.exports.del = function(key, callback) {
  if(!store) {
    log.error('Called redis.del() before start()');
    return callback(new Error('Not connected to Redis.'));
  }

  store.del(key, callback);
};

module.exports.set = function(key, value, callback) {
  if(!store) {
    log.error('Called redis.set() before start()');
    return callback(new Error('Not connected to Redis.'));
  }

  store.set(key, value, callback);
};

module.exports.setnx = function(key, value, callback) {
  if(!store) {
    log.error('Called redis.setnx() before start()');
    return callback(new Error('Not connected to Redis.'));
  }

  store.setnx(key, value, callback);
};

module.exports.get = function(key, callback) {
  if(!store) {
    log.error('Called redis.get() before start()');
    return callback(new Error('Not connected to Redis.'));
  }

  store.get(key, callback);
};
