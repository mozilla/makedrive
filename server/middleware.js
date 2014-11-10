var env = require('./lib/environment');
var log = require('./lib/logger.js');

// Get list of basic auth usernames:passwords from .env (if any)
// Username/password pairs should be listed like "username1:password1,username2:password2"
var basicAuthUsers = require('querystring').parse(env.get('BASIC_AUTH_USERS'), ',', ':');
var basicAuth = require('express').basicAuth;

module.exports = {
  basicAuthHandler: basicAuth(function(user, pass) {
    for (var username in basicAuthUsers) {
      if (basicAuthUsers.hasOwnProperty(username)) {
        if (user === username && pass === basicAuthUsers[username]) {
          return true;
        }
      }
    }
    log.debug('BasicAuth authentication failed for username=%s', user);
    return false;
  }),

  crossOriginHandler: function( req, res, next ) {
    var allowedCorsDomains = env.get("ALLOWED_CORS_DOMAINS");
    if (allowedCorsDomains === "*" || allowedCorsDomains.indexOf(req.headers.origin) > -1) {
      res.header('Access-Control-Allow-Origin', req.headers.origin);
      res.header('Access-Control-Allow-Credentials', true);
    }

    next();
  },

  errorHandler: function(err, req, res, next) {
    if (typeof err === "string") {
      err = new Error(err);
    }

    var error = {
      message: err.message,
      status: err.status ? err.status : 500
    };

    res.status(error.status).json(error);
  },

  fourOhFourHandler: function(req, res, next) {
    var error = {
      message: "Not Found",
      status: 404
    };

    res.status(error.status).json(error);
  }
};
