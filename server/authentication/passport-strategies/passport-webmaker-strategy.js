/**
 * `Strategy` constructor.
 *
 * The Webmaker Authentication strategy authenticates requests based on the Webmaker session.
 * https://github.com/mozilla/webmaker-auth#webmaker-auth-middleware
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
 *     passport.use(new WebmakerStrategy(
 *       function(username, password, done) {
 *         if(!username) {
 *            return done(null, false, { message: "No user found in Webmaker session"});
 *         }
 *         done(null, username);
 *       }
 *     ));
 *
 * @param {Object} options
 * @param {Function} verify
 * @api public
 */

// Module dependencies.
var passport = require('passport-strategy');
var log = require('../../lib/logger');

function Strategy(options, verify) {
  if (typeof options === 'function') {
    verify = options;
    options = {};
  }
  if (!verify) {
    throw new TypeError('WebmakerStrategy requires a verify callback');
  }

  this._usernameField = options.usernameField || 'username';

  passport.Strategy.call(this);
  this.name = 'webmaker';
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
  // Webmaker Auth should have already added a user object to the cookie session.
  var username = req.session.user && req.session.user.username;
  // we don't check password in Webmaker auth
  var password = "";
  // if no username found we can assume that the user is not logged in to Webmaker
  if (!username) {
    return this.fail({ message: 'No user found in Webmaker session' }, 400);
  }

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
