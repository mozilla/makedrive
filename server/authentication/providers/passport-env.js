/**
 * passport-env:
 *   Allow a single user to be authenticated for MakeDrive testing, using credentials in the env file.
 *   to use this provider make sure to set these environment configurations in your .env file
 *   export PASSPORT_USERNAME="someusername"
 *   export PASSPORT_PASSWORD="somepassword"
 *   export AUTHENTICATION_PROVIDER="passport-env"
 */

var passport = require('passport');
var ENVStrategy = require('../passport-strategies/passport-env-strategy').Strategy;
var util = require('./util');

module.exports = {
  init: function (app) {
    passport.use(new ENVStrategy(function(username, password, done) {
      util.isAuthenticated(username, password, done);
    }));
  },
  name: "env"
};
