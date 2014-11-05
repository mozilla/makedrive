var expect = require('chai').expect;
var util = require('../../lib/util.js');
var server = require('../../lib/server-utils.js');
var MakeDrive = require('../../../client/src');
var Filer = require('../../../lib/filer.js');

describe('MakeDrive Client - sync symlink', function() {
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

  /**
   * This test creates a symlink from an existing file
   * and check that they both exists.
   */
  it('should sync symlink', function(done) {
    server.authenticatedConnection(function(err, result) {
      expect(err).not.to.exist;

      var layout = {
        '/file1': 'contents of file1'
      };
      var finalLayout = {
        '/file1': 'contents of file1',
        '/file2': 'contents of file1'
      };

      sync.once('synced', function onDownstreamCompleted() {
        sync.once('synced', function onUpstreamCompleted() {
          server.ensureRemoteFilesystem(layout, result.jar, function() {
            fs.symlink('/file1', '/file2', function(err) {
              if (err) throw err;
              sync.once('completed', function onWriteSymlink() {
                server.ensureRemoteFilesystem(finalLayout, result.jar, done);
              });

              sync.request();
            });
          });
        });

        util.createFilesystemLayout(fs, layout, function(err) {
          expect(err).not.to.exist;

          sync.request();
        });
      });

      sync.connect(server.socketURL, result.token);
    });
  });
});
