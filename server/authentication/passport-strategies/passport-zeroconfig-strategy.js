/**
 * `Strategy` constructor.
 *
 * The zeroconfig strategy always automatically authenticates requests for a single 'root' user. Only use this for development.
 *
 * Examples:
 *
 *     passport.use(new ZEROCONFIGStrategy(
 *       function(username, password, done) {
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
    throw new TypeError('ZEROCONFIGStrategy requires a verify callback');
  }

  this._usernameField = 'username';

  passport.Strategy.call(this);
  this.name = 'zeroconfig';
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
  // Username will always be `root`
  var username = 'root';
  var password = '';
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
