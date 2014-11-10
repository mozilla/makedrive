/**
 * `Strategy` constructor.
 *
 * The local authentication strategy authenticates requests based on the
 * credentials in the environment configuration.
 *
 * Applications must supply a `verify` callback which accepts `username` and
 * `password` object, and then calls the `done` callback supplying a
 * `user`, which should be set to `false` if the credentials are not valid.
 * If an exception occured, `err` should be set.
 *
 * Optionally, `options` can be used to change the fields in which the
 * credentials are found.
 *
 * Options:
 *   - `usernameField`  field name where the username is found, defaults to _username_
 *   - `passwordField`  field name where the password is found, defaults to _password_
 *   - `passReqToCallback`  when `true`, `req` is the first argument to the verify callback (default: `false`)
 *
 * Examples:
 *
 *     passport.use(new ENVStrategy(
 *       function(username, password, done) {
 *          findByUsername(username, function(err, user) {
 *           done(err, user);
 *         });
 *       }
 *     ));
 *
 * @param {Object} options
 * @param {Function} verify
 * @api public
 */

// Module dependencies.
var passport = require('passport-strategy');
var env = require('../../lib/environment');
var log = require('../../lib/logger');

// reading username and password from environment configuration.
var username =  env.get("PASSPORT_USERNAME");
var password = env.get("PASSPORT_PASSWORD");

if(!username || !password) {
  log.error('Missing environment configurations for passport-env. Please check your .env file.');
}

function Strategy(options, verify) {
  if (typeof options === 'function') {
    verify = options;
    options = {};
  }
  if (!verify) {
    throw new TypeError('ENVStrategy requires a verify callback');
  }

  passport.Strategy.call(this);
  this.name = 'env';
  this.username = options.username;
  this._verify = verify;
  this._passReqToCallback = options.passReqToCallback;
}

/**
 * Authenticate request based on the environment configurations.
 *
 * @param {Object} req
 * @api protected
 */
Strategy.prototype.authenticate = function(req, options) {
  var self = this;

  function verified(err, user, info) {
    if (err) {
      return self.error(err);
    }
    if (!user) {
      return self.fail(info);
    }
    self.success(user, info);
  }

  try {
    if (self._passReqToCallback) {
      this._verify(req, username, password, verified);
    } else {
      this._verify(username, password, verified);
    }
  } catch (ex) {
    log.error(ex, 'failed to verify user\'s information');
    return self.error(ex);
  }
};

exports.Strategy = Strategy;
