var Sync = require( './sync');
var SyncMessage = require('../../lib/syncmessage');
var WebSocketServer = require('ws').Server;
var rsync = require('../../lib/rsync');
var rsyncOptions = require('../../lib/constants').rsyncDefaults;
var websocketAuth = require('./websocket-auth');

/**
 * Handle a new ws client connection from the server. The process
 * goes through two phases.  First, the client needs to send a
 * token obtained via the /api/sync HTTP route, identifying them.
 * After we have confirmed the client's identity, we run the sync
 * protocol as normal.
 */
function handleClient(ws) {
  var sync;

  // Clean up client resources for sync and ws, possibly sending
  // error info in the process.
  function cleanup(error) {
    if(!ws) {
      return;
    }

    error = error || {};

    // If we're passed error info, try to close with that first
    if(error.code && error.message) {
      // Ignore onerror with this call
      ws.onerror = function(){};
      ws.close(error.code, error.message);
    }

    // Log error details if present
    if(error.log) {
      console.error(error.log);
    }

    // Shutdown sync session if it exists
    if(sync) {
      var closeSync = function() {
        sync.close();
        sync = null;
      };

      // Closing the sync while it is in the middle of a `patch` step
      // could cause data loss, so we confirm that it is safe.
      if (sync.patching) {
        sync.once('patchComplete', closeSync);
      } else {
        closeSync();
      }
    }

    // Dump all listeners, tear down socket, and kill client reference.
    ws.terminate();
    ws = null;
  }

  // Default error handler for both phases.
  ws.onerror = function(err) {
    cleanup({log: 'Unexpected WebSocket Client Error: ' + err.stack});
  };

  // Default close handler for both phases.
  ws.onclose = function() {
    // Client hung-up early
    cleanup();
  };

  // Phase 1: authorize a client's token and create a sync session
  function authorize() {
    ws.onmessage = function(data, flags) {
      // Get the user's token
      try {
        data = data.data;
        data = JSON.parse(data);
      } catch(e) {
        cleanup({code: 1011, message: 'Error: token could not be parsed.'});
        return;
      }

      // Authorize user
      var token = data.token;
      var username = websocketAuth.getAuthorizedUsername(token);
      if (!username) {
        cleanup({code: 1008, message: 'Error: invalid token.'});
        return;
      }

      // Setup a sync session for this authorized user
      sync = new Sync(username, token, ws);

      // Deal with any failed socket access by sync
      sync.on('error', function(err) {
        cleanup({log: 'Unable to write to client WebSocket: ' + err.stack});
      });

      run();
    };
  }

  // Phase 2: send the client an AUTHZ message and run the sync session
  function run() {
    function invalidMessage() {
      var message = SyncMessage.error.format;
      message.content = {error: 'Unable to parse/handle message, invalid message format.'};
      sync.sendMessage(message);
    }

    ws.onmessage = function(data, flags) {
      if(!flags || !flags.binary) {
        try {
          data = data.data;
          data = JSON.parse(data);
          var message = SyncMessage.parse(data);
          sync.handleMessage(message);
        } catch(error) {
          invalidMessage();
        }
      } else {
        invalidMessage();
      }
    };

    // Send an AUTHZ response to let client know normal sync'ing can begin.
    sync.sendMessage(SyncMessage.response.authz);
  }

  // Begin phase 1
  authorize();
}

/**
 * The WebSocket Server is designed to be able to safely deal with errors
 * and if possible, restart itself. If the websocket server can't be (re)started,
 * the entire server (process) is terminated.
 */
function handleServer(server) {
  var wss;

  function kill() {
    // Close down within 30 seconds
    var killtimer = setTimeout(function() {
      process.exit(1);
    }, 30000);
    // But don't block on that timeout
    killtimer.unref();

    // Stop taking new requests and end.
    server.close(function() {
      process.exit(1);
    });
  }

  function start() {
    // We only want to try a restart if we actually got to listening
    // (so we don't go into an infinite loop with failed server startup)
    var shouldRestart = false;

    console.log('Starting socket server');

    wss = new WebSocketServer({server: server});

    wss.once('listening', function() {
      // Made it to listening, should be OK to restart on error
      shouldRestart = true;
    });

    wss.on('connection', handleClient);

    wss.on('error', function(error) {
      console.error("Socket server error, beginning shutdown process: ", error.stack );

      // Safely conclude active syncs
      Sync.on('allSyncsComplete', function(){
        try {
          wss.close();
        } catch(e) {
          console.error("Error shutting down socket server: ", e.stack );
        }

        wss.removeAllListeners();
        wss = null;

        // Try to start server again if possible, otherwise shutdown the server
        if(shouldRestart) {
          console.log('Attempting to restart socket server...');
          start();
        } else {
          console.error('Unable to restart WebSocket server, shutting down server/process.');
          kill();
        }
      });

      Sync.initiateSafeShutdown();
    });
  }

  start();
}

module.exports = handleServer;
