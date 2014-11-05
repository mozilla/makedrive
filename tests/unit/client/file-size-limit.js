var expect = require('chai').expect;
var util = require('../../lib/util.js');
var server = require('../../lib/server-utils.js');
var MakeDrive = require('../../../client/src');
var Filer = require('../../../lib/filer.js');
var MAX_SIZE_BYTES = 2000000;

describe('Syncing file larger than size limit', function(){
  var fs;
  var sync;
  var username;

  before(function(done) {
    server.start(done);
  });
  after(function(done) {
    server.shutdown(done);
  });

  beforeEach(function() {
    username = util.username();
    fs = MakeDrive.fs({provider: new Filer.FileSystem.providers.Memory(username), manual: true, forceCreate: true});
    sync = fs.sync;
  });
  afterEach(function(done) {
    util.disconnectClient(sync, function(err) {
      if(err) throw err;

      sync = null;
      fs = null;
      done();
    });
  });

  it('should return an error if file exceeded the size limit', function(done) {
    server.authenticatedConnection(function(err, result) {
      expect(err).not.to.exist;

      var layout = {'/hello.txt': new Filer.Buffer(MAX_SIZE_BYTES+1) };

      sync.once('synced', function onClientConnected() {
        util.createFilesystemLayout(fs, layout, function(err) {
          expect(err).not.to.exist;

          sync.request();
        });
      });

      sync.once('error', function onClientError(error) {
        expect(error).to.eql(new Error('Sync interrupted for path /hello.txt'));
        done();
      });

      sync.connect(server.socketURL, result.token);
    });
  });

  it('should not return an error if file did not exceed the size limit', function(done) {
    var everError = false;

    server.authenticatedConnection(function(err, result) {
      expect(err).not.to.exist;

      var layout = {'/hello.txt': new Filer.Buffer(MAX_SIZE_BYTES) };

      sync.once('connected', function onClientConnected() {
        util.createFilesystemLayout(fs, layout, function(err) {
          expect(err).not.to.exist;

          sync.request();
        });
      });

      sync.once('completed', function() {
        expect(everError).to.be.false;
        done();
      });

      sync.once('error', function onClientError() {
        everError = true;
      });

      sync.connect(server.socketURL, result.token);
    });
  });
});
