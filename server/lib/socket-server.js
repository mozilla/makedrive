var Sync = require( './sync'),
    SyncMessage = require('./syncmessage'),
    WebSocketServer = require('ws').Server,
    websocketAuth = require('./websocket-auth');

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

      var syncId = data.syncId;
      if ( !syncId ) {
        return ws.close(1008, "SyncId required");
      }

      // Authorize user
      var token = data.token;
      if ( !token || !websocketAuth.authorizeToken(token) ) {
        return ws.close(1008, "Valid auth token required");
      }
      var sync;

      ws.send(JSON.stringify(SyncMessage.Response.ACK));

      sync = Sync.retrieve( syncId );
      sync.setSocket( ws );

      ws.on('message', function(data, flags) {
        if(!flags || (flags && !flags.binary)) {
          try {
            data = JSON.parse(data);
            sync.messageHandler(data);
          } catch(error) {
            ws.send(JSON.stringify(SyncMessage.generateError(error)));
          }
        }
      });
    });
  });
};
