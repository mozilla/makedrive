/**
 * passport-query-string:
 *   This provider should only be used for local development only.
 *   It allows single user to be authenticated for MakeDrive testing.
 *   to use this provider make sure to set these environment configurations in your .env file
 *   or you could pass in the username and password in the query string
 *   e.g. /api/sync?username=someusername&password=secret
 *   export PASSPORT_USERNAME="someusername"
 *   export PASSPORT_PASSWORD="secret"
 *   export AUTHENTICATION_PROVIDER="passport-query-string"
 */

var passport = require('passport');
var LocalStrategy = require('passport-local').Strategy;
var util = require('./util');

module.exports = {
  init: function (app) {
    passport.use(new LocalStrategy(function(username, password, done) {
      util.isAuthenticated(username, password, done);
    }));
  },
  name: "local"
};
