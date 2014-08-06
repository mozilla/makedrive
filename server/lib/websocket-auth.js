var uuid = require('node-uuid');
var env = require('./environment');

/**
 * This module creates and tracks transaction objects representing
 * an analogue to individual HTTP requests made using sessions authenticated with Webmaker-Auth.
 * Each transaction object can have secure tokens generated for it
 * to be used to prove a user's identity when opening a
 * websocket connection for a particular transaction.
 *
 * generateTokenForClient(username)
 *   - Creates and stores a one-time use token for the passed user.
 *     A user can have multiple tokens at a time, one for each
 *     client session. After a set amount of time, the token expires
 *     and can no longer be used.
 *
 * authorizeToken(token)
 *   - If the token passed exists for a particular user, the token
 *     is deleted from the datastore, returning the username
 */
var authTable = {};
var TOKEN_TIMEOUT_MS = env.get("TOKEN_TIMEOUT_MS") || 60000; // Default to 60 sec

function removeToken(token) {
  var username = getUsernameByToken(token);
  var tokenIndex = authTable[username] && authTable[username].indexOf(token);

  if (tokenIndex > -1){
    authTable[username].splice(tokenIndex, 1);

    if (authTable[username].length === 0) {
      delete authTable[username];
    }
  }
}

function generateTokenForClient(username) {
  if (!authTable[username]) {
    authTable[username] = [];
  }

  var token = uuid.v4();
  authTable[username].push(token);

  // When a token is used to open a websocket,
  // we delete it from authTable to prevent it from being used again.
  // If it isn't used in a reasonable amount of time,
  // we remove it here.
  setTimeout(function(){
    removeToken(token);
  }, TOKEN_TIMEOUT_MS);

  return token;
}

function authorizeToken(token) {
  var username = getUsernameByToken(token);

  // Token isn't valid?
  if (username === null) {
    return null;
  }

  // Token is valid, find and delete it,
  // returning username
  removeToken(token);
  return username;
}

function getUsernameByToken(token) {
  for(var username in authTable) {
    if(authTable[username].indexOf(token) > -1) {
      return username;
    }
  }
  return null;
}

module.exports = {
  generateTokenForClient: generateTokenForClient,
  authorizeToken: authorizeToken
};
