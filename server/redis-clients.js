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
var ChannelConstants = require('../lib/constants.js').server;
var log = require('./lib/logger.js');

// Internal-only client for working with keys
var store;
// Internal-only dedicated pub/sub clients.
// Users should listen for 'message' events,
// and call publish() on the module.
var pub;
var sub;
// When we are shutting down, ignore events on redis clients
var closing;

module.exports = new EventEmitter();

// Deal with the fact that we're going to have a lot of listeners on this emitter
// see http://nodejs.org/api/events.html#events_emitter_setmaxlisteners_n
// TODO: what is a useful limit?  Is unlimited (i.e., 0) OK?
module.exports.setMaxListeners(0);

function onerror(err) {
  if(closing) {
    return;
  }

  // Let top-level server deal with this error
  log.error(err, 'Redis error');
  module.exports.emit('error', err);
}

// Redis server connection lost.
function onend() {
  if(closing) {
    return;
  }

  // TODO: we need a way to not need to error when we lose the single
  // redis instance (e.g., proxy/cluster setup for redis). For now
  // we have a single-point-of-failure, and have to bail.
  onerror(new Error('Redis server hung-up'));
}

// redis subscription messages. Split the different types out based on channel
function onmessage(channel, message) {
  if(closing) {
    return;
  }

  switch(channel) {
    case ChannelConstants.syncChannel:
      module.exports.emit('sync', message);
      break;
    case ChannelConstants.lockRequestChannel:
      module.exports.emit('lock-request', message);
      break;
    case ChannelConstants.lockResponseChannel:
      module.exports.emit('lock-response', message);
      break;
    default:
      log.warn('[Redis] Got unexpected message on channel `%s`. Message was: `%s`', channel, message);
      break;
  }
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
    if(redisUrl.password) {
      client.auth(redisUrl.password);
    }

    // Caller needs to figure out what to do with errors, hang-ups.
    client.on('error', onerror);
    client.on('end', onend);
    client.once('ready', function() {
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

  closing = true;

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
        sub.subscribe(ChannelConstants.syncChannel,
                      ChannelConstants.lockRequestChannel,
                      ChannelConstants.lockResponseChannel,
                      callback);
      });
    });
  });
};

module.exports.close = function(callback) {
  // While we're closing, don't worry about hang-ups, errors from server
  closing = true;

  if(!(store && sub && pub)) {
    // Already closed
    log.warn('RedisClients.close() called while already closed.');
    return callback();
  }

  // XXX: due to https://github.com/mranney/node_redis/issues/439 we
  // can't (currently) rely on our client.quit(callback) callback to
  // fire. As such, we fire and forget.
  store.quit();
  store = null;
  log.info('Redis connection 1/3 closed.');

  pub.quit();
  pub = null;
  log.info('Redis connection 2/3 closed.');

  sub.unsubscribe(ChannelConstants.syncChannel,
                  ChannelConstants.lockRequestChannel,
                  ChannelConstants.lockResponseChannel);
  sub.quit();
  sub = null;
  log.info('Redis connection 3/3 closed.');

  callback();
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
