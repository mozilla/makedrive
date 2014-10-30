var Filer = require('../../lib/filer.js');
var env = require('./environment');
var providerType = env.get('FILER_PROVIDER') || 'filer-fs';
var Provider = require(providerType);
var log = require('./logger.js');

var defaults = {};

function setupFilerS3() {
  var bucket = env.get('S3_BUCKET');
  var key = env.get('S3_KEY');
  var secret = env.get('S3_SECRET');

  if(!(bucket && key && secret)) {
    log.fatal('Missing filer-s3 env configuration');
  }

  defaults.bucket = bucket;
  defaults.key = key;
  defaults.secret = secret;

  log.debug('Using filer-s3 provider');
}

function setupFilerSQL() {
  var type = env.get('DB_TYPE');
  var url = env.get('DB_CONNECTION_URL');
  var dbName = env.get('DB_NAME');
  var dbUsername = env.get('DB_USERNAME');
  var dbPassword = env.get('DB_PASSWORD');

  // Passing a connection url OR db creds are both fine, but one has to be there.
  if(!(type && (url || (dbName && dbUsername && dbPassword)))) {
    log.fatal('Missing filer-sql env configuration');
  }

  defaults.type = Provider[type];
  defaults.url = url;
  defaults.db = {
    name: dbName,
    username: dbUsername,
    password: dbPassword
  };

  log.debug('Using filer-sql provider with ' + type);
}

if(providerType === 'filer-s3') {
  setupFilerS3();
} else if(providerType === 'filer-sql') {
  setupFilerSQL();
} else {
  log.debug('Using filer-fs provider');
}

module.exports.create = function(username) {
  var options = {
    username: username,
    keyPrefix: username
  };

  // In filer-sql we are expecting option 'user' which is the same as 'options.name'
  defaults.user = providerType === 'filer-sql' ? username : '';
  Object.keys(defaults).forEach(function(defaultOption) {
    options[defaultOption] = options[defaultOption] || defaults[defaultOption];
  });

  return new Filer.FileSystem({provider: new Provider(options)}, function(err) {
    if(err) {
      log.error(err, 'MakeDrive Filesystem Initialization Error');
    }
  });
};
