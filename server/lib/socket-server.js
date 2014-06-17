var Sync = require( './sync'),
    SyncMessage = require('./syncmessage'),
    WebSocketServer = require('ws').Server;

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
     if (typeof data !== "string") {
       data = data.data;
     }

     // Capture the connectionId
     var match = /{"syncId"\s*:\s*"(\w{8}(-\w{4}){3}-\w{12}?)"}/.exec(data),
         // TODO: Research websocket authentication (so we can pass username here)
         sync;

     if ( !match ) {
       return ws.close();
     }
     ws.send(JSON.stringify(new SyncMessage(SyncMessage.RESPONSE, SyncMessage.ACK)));

     sync = Sync.retrieve( match[1] );
     sync.addSocket( this );

     ws.on('message', function(data, flags) {
       if(!flags || (flags && !flags.binary)) {
         if (typeof data !== "string") {
           data = data.data;
         }
         try {
           data = JSON.parse(data);
           sync.messageHandler(data);
         } catch(error) {
           var Error = new SyncMessage(SyncMessage.RESPONSE, SyncMessage.ERROR);
           Error.setContent(error.toString() || error);
           this.send(JSON.stringify(Error));
         }
       }
     });
   });
  });
};
