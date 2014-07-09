var Sync = require( './sync'),
    SyncMessage = require('../../lib/syncmessage'),
    WebSocketServer = require('ws').Server,
    websocketAuth = require('./websocket-auth'),
    rsync = require('../../lib/rsync'),
    rsyncOptions = require('../../lib/constants').rsyncDefaults;

module.exports = function( server ) {
  var wss = new WebSocketServer({ server: server });

  // Websockets
  wss.on('error', function( error ) {
    console.error("Socket server error: ", error );
  });

  wss.on('connection', function(ws) {
    ws.once('message', function(data, flags) {
      // Socket data sent from a web browser
      // is accessed through `data.data`, whereas
      // requests sent from the NodeJS `request` module
      // are accessed through `data`.
      data = data.data || data;

      // Capture the syncId + token
      try {
        data = JSON.parse(data);
      } catch(e) {
        return ws.close(1011, "Parsing error: " + e);
      }

      // Authorize user
      var token = data.token;
      var authData = websocketAuth.authorizeToken(token);
      if ( !token || !authData ) {
        return ws.close(1008, "Valid auth token required");
      }

      var sync = Sync.create( authData.username, authData.sessionId );
      sync.setSocket( ws );

      ws.on('close', sync.onClose);

      ws.on('message', function(data, flags) {
        if(!flags || (flags && !flags.binary)) {
          try {
            data = JSON.parse(data);
            sync.messageHandler(data);
          } catch(error) {
            var errorMessage = SyncMessage.error.format;
            errorMessage.content = {error: error};
            ws.send(errorMessage.stringify());
          }
        }
      });

      rsync.sourceList(sync.fs, '/', rsyncOptions, function(err, srcList) {
        var response;
        if(err) {
          response = SyncMessage.error.srclist;
          response.content = {error: err};
        } else {
          response = SyncMessage.request.chksum;
          response.content = {srcList: srcList, path: '/'};
        }

        // Is the websocket still open? If not, don't send anything
        if (ws.readyState === 1) {
          ws.send(SyncMessage.response.authz.stringify());
          ws.send(response.stringify());
        }
      });
    });
  });
};
