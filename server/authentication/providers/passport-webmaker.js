/**
 * passport-webmaker:
 *   This provider is meant to be used for either local development or production, and requires a Webmaker Login server to be running.
 *   https://github.com/mozilla/webmaker-auth#webmaker-auth-middleware
 *
 *   It allows user to be authenticated using Webmaker session.
 *   You will need to have webmaker login app running with cookie session configured
 *   to use this provider make sure to set these environment configurations in your .env file
 *   export AUTHENTICATION_PROVIDER="passport-webmaker"
 *   export LOGIN="http://localhost:3000"
 *   export SESSION_SECRET="dummy secret value"
 *   export COOKIE_DOMAIN=""
 */

var env = require('../../lib/environment');
var passport = require('passport');
var WebmakerStrategy = require('../passport-strategies/passport-webmaker-strategy').Strategy;
var WebmakerAuth = require('webmaker-auth');
var log = require('../../lib/logger');

if(!env.get('LOGIN') || !env.get('SESSION_SECRET')) {
  log.error('Missing environment configurations for WebmakerAuth. Please check your .env file.');
}

var webmakerAuth = new WebmakerAuth({
  loginURL: env.get('LOGIN'),
  secretKey: env.get('SESSION_SECRET'),
  forceSSL: env.get('FORCE_SSL'),
  domain: env.get('COOKIE_DOMAIN')
});

module.exports = {
  init: function (app) {
    passport.use(new WebmakerStrategy(
      function(username, password, done) {
        process.nextTick(function () {
          if(!username) {
            return done(null, false, { message: "No user found in Webmaker session"});
          }
          done(null, username);
        });
      }
    ));
    // Setup WebmakerAuth cookie session
    app.use(webmakerAuth.cookieParser());
    app.use(webmakerAuth.cookieSession());
  },
  name: "webmaker"
};
