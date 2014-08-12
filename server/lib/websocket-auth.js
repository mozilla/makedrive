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
 * getAuthorizedUsername(token)
 *   - returns the username associated with a given token, or null.
 */
var authTable = {};
var TOKEN_TIMEOUT_MS = env.get("TOKEN_TIMEOUT_MS") || 60000; // Default to 60 sec

function getUsernameByToken(token) {
  for(var username in authTable) {
    if(authTable[username].indexOf(token) > -1) {
      return username;
    }
  }
  return null;
}

function revokeToken(token) {
  var username = getUsernameByToken(token);
  if(!username) {
    return;
  }

  var clients = authTable[username];
  var tokenIndex = clients && clients.indexOf(token);
  if (tokenIndex === -1) {
    return;
  }

  clients.splice(tokenIndex, 1);
  if(clients.length === 0) {
    delete authTable[username];
  }
}

function generateTokenForClient(username) {
  if (!authTable[username]) {
    authTable[username] = [];
  }

  var token = uuid.v4();
  console.log('Adding ', token);
  authTable[username].push(token);
  console.log('auth: ', authTable[username]);

  // When a token is used to open a websocket,
  // we delete it from authTable to prevent it from being used again.
  // If it isn't used in a reasonable amount of time,
  // we remove it here.
  setTimeout(function(){
    revokeToken(token);
  }, TOKEN_TIMEOUT_MS);

  return token;
}

function getAuthorizedUsername(token) {
  var username = getUsernameByToken(token);

  // If token is valid, revoke it now that it's been used.
  if(username) {
    revokeToken(token);
  }

  // Return username (could be `null` if no username was found).
  return username;
}

module.exports = {
  generateTokenForClient: generateTokenForClient,
  getAuthorizedUsername: getAuthorizedUsername
};
