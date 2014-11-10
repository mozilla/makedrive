/**
 * passport-github:
 *   This module lets you authenticate using GitHub in your Node.js applications for MakeDrive.
 *   to use this provider make sure to set these environment configurations in your .env file
 *   export GITHUB_CLIENTID="clientId"
 *   export GITHUB_CLIENTSECRET="clientSecret"
 *   export GITHUB_CALLBACKURL="http://callbackurl"
 *   export AUTHENTICATION_PROVIDER="passport-github"
 */

var env = require('../../lib/environment');
var passport = require('passport');
var GithubStrategy = require('passport-github').Strategy;
var clientID = env.get('GITHUB_CLIENTID');
var clientSecret = env.get('GITHUB_CLIENTSECRET');
var callbackURL = env.get('GITHUB_CALLBACKURL');
var log = require('../../lib/logger');

if(!clientID || !clientSecret || !callbackURL) {
  log.error('Missing environment configurations for password-github. Please check your .env file.');
}

module.exports = {
  init: function (app) {
    passport.use(new GithubStrategy({
      clientID: clientID,
      clientSecret: clientSecret,
      callbackURL: callbackURL
    }, function(accessToken, refreshToken, profile, done) {
      process.nextTick(function () {
        return done(null, profile);
      });
    }));
  },
  name: "github"
};
