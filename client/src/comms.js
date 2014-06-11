var ws = require( 'ws' ),
    source,
    socket,
    request = require( 'request' ),
    SyncMessage = require( './syncmessage' ),
    rsync = require('./rsync'),
    fs,
    uri,
    checksum = {};

var rsyncOptions = {
  size: 5,
  time: true,
  recursive: true
};

var states = {
  CONN_CLOSED: -1,
  ERROR: 0,
  CONN_OPEN: 1,
  CHKSUM: 2,
  CHKSUM_ACK: 3
};

var syncState;

function convert() {
  var diffs = this;
  var k;
  // Parse JSON diffs to Uint8Array
  for ( var i = 0; i < diffs.length; i++ ) {
    if( diffs[i].contents ) {
      for ( var j = 0; j < diffs[i].contents.length; j++ ) {
        for ( k = 0; k < diffs[i].contents[j].diffs.length; k++ ) {
          if ( diffs[i].contents[j].diffs[k].data ) {
            diffs[i].contents[j].diffs[k].data = diffs[i].contents[j].diffs[k].data;
            if ( diffs[i].contents[j].diffs[k].data.__isUint8Array ) {
              diffs[i].contents[j].diffs[k].data = new Uint8Array( diffs[i].contents[j].diffs[k].data.__array );
            }
          }
        }
      }
    } else {
      for ( k = 0; k < diffs[i].diffs.length; k++ ) {
        if ( diffs[i].diffs[k].data ) {
          diffs[i].diffs[k].data = diffs[i].diffs[k].data;
          if ( diffs[i].diffs[k].data.__isUint8Array ) {
            diffs[i].diffs[k].data = new Uint8Array( diffs[i].diffs[k].data.__array );
          }
        }
      }
    }
  }
  return diffs;
}

module.exports = { 
  init: function( options, initial, callback ) {
    // TODO: Proper URL validation
    if ( !options.uri ) {
      return initial( new Error( "Socket server URI required" ) );
    }
    uri = options.uri;
    fs = options.fs;
    var path;
    source = new EventSource( uri + '/api/sync/updates' );
    source.addEventListener( 'message', function f( event ) {
      var data,
          connectionId;
      try {
        data = JSON.parse( event.data );
        // If this is the first message, capture the connectionId
        connectionId = data.syncId;
      } catch (e) {
        data = e.data;
      }
      // Open socket
      socket = new WebSocket( uri.replace( "http", "ws" ) );

      // Remove this event listener now that we have connectionId
      source.removeEventListener( 'message', f );
      source.addEventListener( 'message', function ( e ) {
        // Request sourcelist
        socket.send( JSON.stringify( new SyncMessage( SyncMessage.REQUEST, SyncMessage.SOURCE_LIST ) ) );
      }, false);


      socket.onopen = function() {
        var data  = JSON.stringify({
          syncId: connectionId
        });
        socket.send(data);
        // Set up listeners
        socket.onmessage = function b( data, flags ) {
          // Parse the data into an object
          data = data.data;
          try {
            data = JSON.parse( data );
          } catch( e ) {
            return callback( e );
          }
          
          if( data.type === SyncMessage.RESPONSE && data.name === SyncMessage.ACK ) {
            syncState = states.CONN_OPEN;
            socket.removeEventListener('message', b);
            socket.onmessage = function(data, flags) {
              data = data.data;
              try {
                data = JSON.parse( data );
              } catch( e ) {
                return callback( e );
              }
              // Is the object a request or response
              if ( data.type === SyncMessage.RESPONSE ) {
                if ( data.name === SyncMessage.SOURCE_LIST  && syncState === states.CONN_OPEN ) {
                  var srcList = data.content.srcList;
                  path = data.content.path;

                  return rsync.checksums( fs, path, srcList, rsyncOptions, function( err, checksums ) {
                    if ( err ) {
                      syncState = states.ERROR;
                      return callback( err );
                    }

                    syncState = states.CHKSUM;
                    checksum[path] = checksums;

                    var message = new SyncMessage( SyncMessage.RESPONSE, SyncMessage.CHECKSUM );

                    socket.send( JSON.stringify( message ) );
                    return callback();
                  });
                }

                if( data.name === SyncMessage.DIFF && states.CHKSUM_ACK ) {
                  var diffs = data.content.diffs;
                  path = data.content.path;

                  convert.call( diffs );
                  return rsync.patch( fs, path, diffs, rsyncOptions, function( err ) {
                    if ( err ) {
                      syncState = states.ERROR;
                      return callback( err );
                    }

                    syncState = states.CONN_OPEN;
                    var message = new SyncMessage( SyncMessage.RESPONSE, SyncMessage.PATCH );
                    socket.send( JSON.stringify( message ) );
                    callback();
                  });
                }

                if( data.name === SyncMessage.ACK && syncState === states.CHKSUM ) {
                  syncState = states.CHKSUM_ACK;
                  var message = new SyncMessage( SyncMessage.REQUEST, SyncMessage.DIFF );
                  message.setContent( { checksums: checksum[data.content.path] } );
                  socket.send( JSON.stringify( message ) );
                  return callback();
                }

                if( data.name === SyncMessage.ERROR ) {
                  syncState = states.ERROR;
                  return callback( new Error( data.content ) );
                }
                
                if( data.name === SyncMessage.ACK ) {
                  syncState = states.CONN_OPEN;
                  return callback();
                }
                return callback( new Error( data.content ) );
              }
              return callback(new Error('Cannot handle message'));
            };
            return initial(null, connectionId);
          }
          return initial(new Error('Cannot connect to server'));
        };
      };

      socket.onclose = function() { 
        syncState = states.CONN_CLOSED;
        return callback( new Error( 'Socket connection was closed' ));
      };

      socket.onerror = function( err ) {
        return callback( err );
      };
    });
  }
}
