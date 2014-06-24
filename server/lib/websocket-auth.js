var uuid = require('node-uuid');
var env = require('./environment');

/**
 * This module creates and tracks session objects representing
 * an analogue to sessions authenticated with Webmaker-Auth.
 * Each session object can have secure tokens generated for it
 * to be used to prove a user's identity when opening a
 * websocket connection for a particular session.
 *
 * createSessionTracker(username)
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

function createSessionTracker() {
  var sessionId = uuid.v4();
  authTable[sessionId] = [];
  return sessionId;
}

function generateTokenForSession(sessionId) {
  var sessionData = authTable[sessionId];
  var token = uuid.v4();

  // Invalidate the token if the client doesn't
  // use it in time.
  setTimeout(function(){
    if (authTable[sessionId]){
      sessionData.splice(sessionData.indexOf(token), 1);
    }
  }, TOKEN_TIMEOUT_MS);

  sessionData.push(token);
  return token;
}

function authorizeToken(token) {
  var sessionId,
      username,
      i;

  for (sessionId in authTable) {
    session = authTable[sessionId];

    for (i = 0; i < session.length; i++) {
      if (session[i] === token) {
        session.splice(i, 1);
        return true;
      }
    }
  }
  return false;
}

function purgeSession(sessionId) {
  var sessionData = authTable[sessionId];

  if (sessionData) {
    delete authTable[sessionId];
  }
}

function logoutHandler(req, res, next) {
  purgeSession(req.params.sessionId);
  next();
}

module.exports = {
  createSessionTracker: createSessionTracker,
  generateTokenForSession: generateTokenForSession,
  authorizeToken: authorizeToken,
  purgeSession: purgeSession,
  logoutHandler: logoutHandler
};
