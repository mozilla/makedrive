var Sync = require( './sync'),
    SyncMessage = require('./syncmessage'),
    WebSocketServer = require('ws').Server;

module.exports = function( server ) {
  var wss = new WebSocketServer({ server: server });

  // Websockets
  wss.on('error', function( error ) {
    console.error("Socket server error: ", error );
  });

  wss.on('connection', function f(ws) {
   ws.onmessage = function(data, flags) {
     // Capture the connectionId
     // Remove event listener for "this"
     var match = /{"syncId"\s*:\s*"(\w{8}(-\w{4}){3}-\w{12}?)"}/.exec(data.data),
         // TODO: Research websocket authentication (so we can pass username here)
         sync;

     if ( !match ) {
       console.error('Sync ID provided was not recognized');
       return ws.close();
     }
     ws.onmessage = null;
     ws.send(JSON.stringify(new SyncMessage(SyncMessage.RESPONSE, SyncMessage.ACK)));

     sync = Sync.retrieve( match[1] );
     sync.addSocket( ws );
     ws.onmessage = function(data, flags) {
       if(!flags || (flags && !flags.binary)) {
         data = data.data;
         try {
           data = JSON.parse(data);
           sync.messageHandler(data);
         } catch(error) {
           var Error = new SyncMessage(SyncMessage.RESPONSE, SyncMessage.ERROR);
           Error.setContent(error);
           ws.send(JSON.stringify(Error));
         }
       }
     };
   };
  });
};
