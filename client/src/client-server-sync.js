var syncID,
    rsync = require('./rsync'),
    paths,
    request = require( 'request' ),
    superagentRequest = require( 'superagent' ),
    rsyncOptions = {
      time: true,
      recursive: true,
      size: 5
    };

module.exports = {
  sync: function sync( fs, uri, connectionId, path, callback ) {
    uri = uri + '/api/sync/';
    var reqOptions = {
      uri: uri + connectionId
    },
    syncID;
    request( reqOptions, function( error, response, body ) {
      if( error || response.statusCode !== 200 ) {
        return callback( error );
      }
      syncID = JSON.parse( body ).syncId;
      uri += syncID + '/';

      rsync.sourceList( fs, path, rsyncOptions, function( err, srcList ) {
        if( err ) {
          return callback( err );
        }
        reqOptions.uri = uri + 'sources';
        reqOptions.method = 'POST';
        reqOptions.json = {
          srcList: srcList,
          path: path
        };
        request( reqOptions, function( error, response, body ) {
          if( error || response.statusCode !== 201 ) {
            return callback( error );
          }
          reqOptions.uri = uri + 'checksums';
          reqOptions.method = 'GET';
          delete reqOptions.json;
          request( reqOptions, function( error, response, body ) {
            if( error || response.statusCode !== 200 ) {
              return callback( error );
            }
            var checksums = JSON.parse( body ).checksums;
            rsync.diff( fs, path, checksums, rsyncOptions, function( err, diffs ) {
              if( err ) {
                return callback( err );
              }
              var req = superagentRequest.put( uri + 'diffs' )
                .field( 'user[diffs]', JSON.stringify( diffs ) );
              var k;
              // Parse JSON diffs to Uint8Array
              for ( var i = 0; i < diffs.length; i++ ) {
                if ( diffs[i].contents ) {
                  for ( var j = 0; j < diffs[i].contents.length; j++ ) {
                    for ( k = 0; k < diffs[i].contents[j].diffs.length; k++ ) {
                      if ( diffs[i].contents[j].diffs[k].data ) {
                        req.attach( 'webmasterfile', new Blob( [diffs[i].contents[j].diffs[k].data], {
                          type: 'application/octet-binary'
                        } ), diffs[i].contents[k].diffs[k].path );
                        if(diffs[i].contents[j].diffs[k]) {
                          delete diffs[i].contents[j].diffs[k].data;
                        }
                      }
                    }
                  }
                } else {
                  for ( k = 0; k < diffs[i].diffs.length; k++ ) {
                    if ( diffs[i].diffs[k].data ) {
                      req.attach( 'webmasterfile', new Blob( [diffs[i].diffs[k].data], {
                        type: 'application/octet-binary'
                      } ), diffs[i].diffs[k].path );
                      if(diffs[0].diffs[0]) {
                        delete diffs[0].diffs[0].data;
                      }
                    }
                  }
                }
              }
              req.end( function( res ) {
                if( res.status !== 200 ) {
                  return callback( error );
                }
                return callback();
              });
            });
          });
        });
      });
    });
  }
};
