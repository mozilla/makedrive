var uuid = require('node-uuid');
var env = require('./environment');

/**
 * This module creates and tracks transaction objects representing
 * an analogue to individual HTTP requests made using sessions authenticated with Webmaker-Auth.
 * Each transaction object can have secure tokens generated for it
 * to be used to prove a user's identity when opening a
 * websocket connection for a particular transaction.
 *
 * createTransactionTracker(username)
 *   - Creates an array to store tokens for a particular
 *     user session, and returns the UUID representing it.
 *
 * generateTokenForSession(username, sessionId)
 *   - Creates and stores a one-time use token for the passed user.
 *     A user can have multiple tokens at a time, one for each
 *     client session. After a set amount of time, the token expires
 *     and can no longer be used.
 *
 * authorizeToken(token)
 *   - If the token passed exists for a particular user, the token
 *     is deleted from the datastore, returning true.
 *
 * purgeSession(username, sessionId)
 *   - Deletes all tokens for a particular user session, intended to be
 *     used on webmakerauth signout.
 */
var authTable = {};
var TOKEN_TIMEOUT_MS = env.get("TOKEN_TIMEOUT_MS") || 60000; // Default to 60 sec

function createTransactionTracker(username, sessionId) { debugger;
  if (!authTable[username]) {
    authTable[username] = {};
  }

  sessionId = uuid.v4();

  authTable[username][sessionId] = [];
  return sessionId;
}

function generateTokenForSession(username, sessionId) { debugger;
  var sessionData = authTable[username][sessionId];
  var token = uuid.v4();

  // Invalidate the token if the client doesn't
  // use it in time.
  setTimeout(function(){
    if (authTable[username][sessionId]){
      sessionData.splice(sessionData.indexOf(token), 1);
    }
  }, TOKEN_TIMEOUT_MS);

  sessionData.push(token);
  return token;
}

function authorizeToken(token) {
  var username = getUsernameByToken(token),
      session,
      index;

  // Token isn't valid?
  if (username === null) { debugger;
    return null;
  }

  // Token is valid, find and delete it,
  // returning username & sessionId
  for (var id in authTable[username]) {
    session = authTable[username][id];
    index = session.indexOf(token);

    if (index >= 0) { debugger
      session.splice(index, 1);
      return  {
        username: username,
        sessionId: id
      };
    }
  }
  return null;
}

function purgeSession(sessionId) { debugger;
  var sessionData = authTable[sessionId];

  if (sessionData) {
    delete authTable[sessionId];
  }
}

function logoutHandler(req, res, next) {
  purgeSession(req.params.sessionId);
  next();
}

function getUsernameByToken(token) {
  for (var username in authTable) {
    for (var id in authTable[username]) {
      if (authTable[username][id].indexOf(token) >= 0) {
        return username;
      }
    }
  }
  return null;
}

module.exports = {
  createTransactionTracker: createTransactionTracker,
  generateTokenForSession: generateTokenForSession,
  authorizeToken: authorizeToken,
  purgeSession: purgeSession,
  logoutHandler: logoutHandler
};
