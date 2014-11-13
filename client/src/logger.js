/**
 * Simplified Bunyan-like logger for browser.
 * https://github.com/trentm/node-bunyan
 *
 * Set the level with logger.level(...). By default
 * no logging is done. Call logger level methods to
 * potentially log, depending on current log level.
 */

// Log Levels
var TRACE = 10;
var DEBUG = 20;
var INFO = 30;
var WARN = 40;
var ERROR = 50;
var FATAL = 60;
var DISABLED = 100;

var levelFromName = {
  'trace': TRACE,
  'debug': DEBUG,
  'info': INFO,
  'warn': WARN,
  'error': ERROR,
  'fatal': FATAL,
  'disabled': DISABLED
};

var levelFromNumber = {
  TRACE: 'trace',
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
  FATAL: 'fatal',
  DISABLED: 'disabled'
};

// By default, we won't log anything
var currentLogLevel = DISABLED;

function log(level, args) {
  if(currentLogLevel > level) {
    return;
  }

  args = Array.prototype.slice.call(args);
  args.unshift('[MakeDrive]', (levelFromNumber[level] || '').toUpperCase() + ':');

  console[level >= ERROR ? 'error' : 'log'].apply(console, args);
}

module.exports = {
  trace: function() {
    log(TRACE, arguments);
  },

  debug: function() {
    log(DEBUG, arguments);
  },

  info: function() {
    log(INFO, arguments);
  },

  warn: function() {
    log(WARN, arguments);
  },

  error: function() {
    log(ERROR, arguments);
  },

  fatal: function() {
    log(FATAL, arguments);
  },

  TRACE: TRACE,
  DEBUG: DEBUG,
  INFO: INFO,
  WARN: WARN,
  ERROR: ERROR,
  FATAL: FATAL,
  DISABLED: DISABLED,

  // Get or Set the current log level. To disable use DISABLED (default).
  level: function(nameOrNum) {
    if(nameOrNum === undefined) {
      return currentLogLevel;
    }

    if(typeof(nameOrNum) === 'string') {
      nameOrNum = levelFromName[nameOrNum.toLowerCase()];
    }

    if(nameOrNum === undefined ||
       !(TRACE <= nameOrNum && nameOrNum <= DISABLED)) {
      throw new Error('invalid log level: ' + nameOrNum);
    }

    currentLogLevel = nameOrNum;
  }
};
