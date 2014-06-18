var interface = require('./interface');

module.exports = {
  Filer: require( "filer" ),
  init: interface.init,
  sync: interface.sync
};
