// Active syncs manager, with list of active syncs keyed by username. While
// a given user may connect multiple sessions at once (multiple browsers
// or devices), only one of these connections can sync upstream to the server
// at a time. This keeps track of which client connection is currently syncing
// for the given username (if any), and manages access to the active sync per user.

// TODO: Integrate with Redis
//       https://github.com/mozilla/makedrive/issues/304
var syncs = {};

// Returns only if a user is currently updating their remote filesystem
// on the MakeDrive server.
function byUsername(username) {
  return syncs[username];
}

// Used to indicate that the remote filesystem is finished being updated
function remove(username) {
  var sync = byUsername(username);
  if(!sync) {
    return;
  }

  sync.reset();
  delete syncs[sync.username];
}

// Flags which client of a particular user is updating their remote filesystem
function set(sync) {
  if(byUsername(sync.username)) {
    remove(sync.username);
  }
  syncs[sync.username] = sync;
}

module.exports = {
  set: set,
  remove: remove,
  byUsername: byUsername,

  // This is used to confirm whether the server is actively
  // updating any user's remote filesystem. This is important for
  // error recovery on Websocket server crashes.
  get areSyncsActive() { return !!Object.keys(syncs).length; }
};
