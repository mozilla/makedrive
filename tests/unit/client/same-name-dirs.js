var expect = require('chai').expect;
var util = require('../../lib/util.js');
var server = require('../../lib/server-utils.js');
var MakeDrive = require('../../../client/src');
var Filer = require('../../../lib/filer.js');

describe('Syncing dirs with entries of the same name', function(){
  var fs;
  var sync;

  before(function(done) {
    server.start(done);
  });
  after(function(done) {
    server.shutdown(done);
  });

  beforeEach(function() {
    fs = MakeDrive.fs({provider: new Filer.FileSystem.providers.Memory(util.username()), manual: true, forceCreate: true});
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

  it('should be able to sync a file contained within a directory of the same name', function(done) {
    server.authenticatedConnection(function(err, result1) {
      expect(err).not.to.exist;

      var file1 = {'/path/path': 'This is file 1'};

      sync.once('synced', function onClient1Connected() {
        expect(err).not.to.exist;

        sync.once('synced', function onClient1Upstream1() {
          server.ensureRemoteFilesystem(file1, result1.jar, function(err) {
            expect(err).not.to.exist;
            done();
          });
        });

        util.createFilesystemLayout(fs, file1, function(err) {
          expect(err).not.to.exist;

          util.ensureFilesystem(fs, file1, function(err) {
            expect(err).not.to.exist;
            sync.request();
          });
        });
      });

      sync.connect(server.socketURL, result1.token);
    });
  });

  it('should be able to sync directories contained in a direcotry with the same name if it contains a file', function(done) {
    server.authenticatedConnection(function(err, result1) {
      expect(err).not.to.exist;

      var file1 = {'/dir/dir/file1.txt': 'This is file 1'};

      sync.once('synced', function onClient1Connected() {
        expect(err).not.to.exist;

        sync.once('synced', function onClient1Upstream1() {
          server.ensureRemoteFilesystem(file1, result1.jar, function(err) {
            expect(err).not.to.exist;
            done();
          });
        });

        util.createFilesystemLayout(fs, file1, function(err) {
          expect(err).not.to.exist;

          util.ensureFilesystem(fs, file1, function(err) {
            expect(err).not.to.exist;
            sync.request();
          });
        });
      });

      sync.connect(server.socketURL, result1.token);
    });
  });
});
