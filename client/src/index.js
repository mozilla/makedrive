var rsync = require( "../../server/lib/rsync" );

module.exports = {
  Filer: require( "filer" ),
  rsync: rsync,
  comms: require( "./comms" )( rsync )
};
