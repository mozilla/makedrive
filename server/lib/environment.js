// XXX: habitat overwrites process env variables with what's in .env
// making it impossible to do `LOG_LEVEL=... npm start` and defining
// a variable just for the lifetime of a command.  Here we check what's
// on the env first, and fix it if it gets overwritten.
var LOG_LEVEL = process.env.LOG_LEVEL;

var habitat = require('habitat');
habitat.load(require('path').resolve(__dirname, '../../.env'));
var env = new habitat();

// Fix-up LOG_LEVEL if present on env and different than habitat's
if(LOG_LEVEL) {
  var hLOG_LEVEL = env.get('LOG_LEVEL');
  if(hLOG_LEVEL && hLOG_LEVEL !== LOG_LEVEL) {
    env.set('LOG_LEVEL', LOG_LEVEL);
  }
}

module.exports = env;
