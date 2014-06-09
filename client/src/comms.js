var ws = require( 'ws' ),
    source = new EventSource('/api/sync/updates'),
    request = require('request'),
    SyncMessage = require('syncmessage');

var rsyncOptions = {
  size: 5,
  links: false,
  recursive: true
};


module.exports = function( rsync ) {
  return function( options, callback ) {
    source.addEventListener('message', function (e) {
      var data,
          connectionId;

      // TODO: Proper URL validation
      if ( !options.uri ) {
        return new Error("Socket server URI required");
      }

      try {
        data = JSON.parse(e.data);
        // If this is the first message, capture the connectionId
        connectionId = data.syncId;
      } catch (e) {
        data = e.data;
      }

      // Remove this event listener now that we have connectionId
      source.removeEventListener('message', this);
      source.addEventListener('message', function (e) {

      }, false);

      // Open socket
      var socket = new ws.WebSocket( options.uri );

      socket.on( "open", function() {
        socket.send(JSON.stringify({
          connectionId: connectionId
        }), function() {
          // Set up listeners
          socket.on( "message", function( data, flags ) {
            // Parse the data into an object
            try {
              data = JSON.parse( data );
            } catch( e ) {
              return callback( e );
            }

            // Is the object a request or reesponse
            if ( data.type === SyncMessage.RESPONSE ) {
              if ( data.name === SyncMessage.SOURCE_LIST ) {
                var srcList = data.contents.srcList,
                    path = data.contents.path;

                return rsync.checksums( options.fs, path, srcList, rsyncOptions, function( err, checksums ) {
                  if ( err ) {
                    return callback( err );
                  }

                  var message = new SyncMessage( SyncMessage.RESPONSE, SyncMessage.CHECKSUM );

                  socket.send( JSON.stringify( message ), function() {
                    // Listen for Diffs, then:
                      // Patch client filesystem
                      // Send ACK
                      // Receive ACK
                  });
                }
              }
            }
              // What is it requesting?
              // What is the response?
                // Sourcelist
                  // Calculate checksums, send ack
                // ACK
                  // Next steps, maybe storee state
          });
        });
      });


    });

    return {
      openSocket: function(){
    //  options = options || {};
    //
    //  // TODO: Proper URL validation
    //  if ( !options.uri ) {
    //    return new Error("Socket server URI required");
    //  }

    //  var socket = new ws.WebSocket( options.uri );

    //  socket.on( "open", function() {
    //
    //  }
      }
    }
  }
};


