var initialize = require( "./comms" ).init,
    connectionId,
    fs,
    serverURI,
    syncUpstream = require( "./client-server-sync" ).sync,
    Filer = require( "filer" );

function initiateConnection(uri, fileSystem, callback) {
  if(!fileSystem || !(fileSystem instanceof Filer.FileSystem)) {
    return callback(new Error('Invalid file system instance passed'));
  }
  fs = fileSystem;
  serverURI = uri;
  var options = {
    uri: serverURI,
    fs: fs
  };
  initialize(options, function(err, id) {
    if(err) {
      return callback(err);
    }
    connectionId = id;
    callback();
  }, callback);
}

function sync(path, callback) {
  if(!fs) {
    return callback(new Error('Makedrive has not been initialized with a filesystem'));
  }
  if(!serverURI) {
    return callback(new Error('Makedrive has not been initialized with a server URI'));
  }
  if(!connectionId) {
    return callback(new Error('Makedrive could not establish a connection with the server'));
  }
  syncUpstream(fs, serverURI, connectionId, path, callback);
}

module.exports = {
  init: initiateConnection,
  sync: sync
};
