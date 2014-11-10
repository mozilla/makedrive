var env = require('../../lib/environment');
var passportUsername = env.get("PASSPORT_USERNAME");
function findByUsername(username, fn) {
  if (passportUsername === username) {
    return fn(null, passportUsername);
  }
  return fn(null, null);
}

module.exports.isAuthenticated = function(username, password, done) {
  process.nextTick(function () {
    findByUsername(username, function(err, user) {
      if (err) { return done(err); }
      if (!user) { return done(null, false, { message: 'Unknown user ' + username }); }
      if (env.get("PASSPORT_PASSWORD") !== password) { return done(null, false, { message: 'Invalid password' }); }
      return done(null, user);
    });
  });
};
