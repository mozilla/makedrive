/**
 * passport-zeroconfig:
 *   Allow a single user `root` to be authenticated for MakeDrive testing.
 *   to use this provider make sure to set these environment configuration in your .env file
 *   export AUTHENTICATION_PROVIDER="passport-zeroconfig"
 */

var passport = require('passport');
var ZEROCONFIGStrategy = require('../passport-strategies/passport-zeroconfig-strategy').Strategy;

module.exports = {
  init: function (app) {
    passport.use(new ZEROCONFIGStrategy(function(username, password, done) {
      done(null, username);
    }));
  },
  name: "zeroconfig"
};
