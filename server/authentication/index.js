var env = require('../lib/environment');
var passport = require('passport');
var Path = require('path');
var passportProvider = env.get('AUTHENTICATION_PROVIDER');
var log = require('../lib/logger.js');

try {
  passportProvider = require(Path.join(__dirname, 'providers', passportProvider));
} catch (e) {
  log.error(e, '%s was not found in server/authentication/providers/*. Please check your AUTHENTICATION_PROVIDER setting in .env', passportProvider);
}

function generateError(code, msg) {
  var err = new Error(msg);
  err.status = code;
  return err;
}

module.exports.init = function (app) {
  // serialize and deserialize user's object using passport
  passport.serializeUser(function(user, done) {
    done(null, user);
  });
  passport.deserializeUser(function(obj, done) {
    done(null, obj);
  });

  // load passport provider
  passportProvider.init(app);
  app.use(passport.initialize());
};

module.exports.handler = function(req, res, next) {
  passport.authenticate(passportProvider.name, function(err, user, info) {
    // If something went wrong with authenticate method
    if(err) {
      log.error(err, 'Unable to authenticate with %s', passportProvider.name);
      return next(500, err);
    } else if (info) {
      // If missing credentials or unknown user
      return next(generateError(401, info.message));
    }
    // Otherwise try to login, so we can have user's information added to the session
    req.login(user, function(err) {
      if(err) {
        log.error(err, 'Unable to login user %s', user);
        return next(err);
      }
      if (!req.user) {
        return next(generateError(401, "Unauthorized"));
      }
      // Add username to params so it can be accessed elsewhere by MakeDrive
      log.debug('User %s authenticated', req.user);
      req.params.username = req.user;
    });

    next();
  })(req, res, next);
};
