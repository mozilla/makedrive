var env = require('../../../server/lib/environment');
var expect = require('chai').expect;
var util = require('../../lib/util.js');
var MakeDrive = require('../../../client/src');
var Filer = require('../../../lib/filer.js');
var MAX_SIZE_BYTES = 2000000;

describe('Syncing file larger than size limit', function(){
  var provider;

  beforeEach(function() {
    var username = util.username();
    provider = new Filer.FileSystem.providers.Memory(username);
  });
  afterEach(function() {
    provider = null;
  });

  it('should return an error if file exceeded the size limit', function(done) {
    util.authenticatedConnection(function(err, result) {
      expect(err).not.to.exist;

      var fs = MakeDrive.fs({provider: provider, manual: true, forceCreate: true});
      var sync = fs.sync;
      var layout = {'/hello.txt': new Filer.Buffer(MAX_SIZE_BYTES+1) };

      sync.once('connected', function onClientConnected() {

        util.createFilesystemLayout(fs, layout, function(err) {
          expect(err).not.to.exist;

          sync.request();
        });

      });
      sync.once('error', function onClientError(error) {
        expect(error).to.eql(new Error('Maximum file size exceeded'));
        done();
      });

      sync.connect(util.socketURL, result.token);
    });
  });

  it('should not return an error if file did not exceed the size limit', function(done) {
    var everError = false;

    util.authenticatedConnection(function(err, result) {
      expect(err).not.to.exist;

      var fs = MakeDrive.fs({provider: provider, manual: true, forceCreate: true});
      var sync = fs.sync;
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
      sync.once('error', function onClientError(error) {
        everError = true;
      });

      sync.connect(util.socketURL, result.token);
    });
  });
});
