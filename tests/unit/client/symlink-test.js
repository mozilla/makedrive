var expect = require('chai').expect;
var util = require('../../lib/util.js');
var MakeDrive = require('../../../client/src');
var Filer = require('../../../lib/filer.js');

describe('MakeDrive Client - sync symlink', function() {
  var provider;

  beforeEach(function() {
    provider = new Filer.FileSystem.providers.Memory(util.username());
  });
  afterEach(function() {
    provider = null;
  });

  /**
   * This test creates a symlink from an existing file
   * and check that they both exists.
   */
  it('should sync symlink', function(done) {
    util.authenticatedConnection(function(err, result) {
      expect(err).not.to.exist;

      var fs = MakeDrive.fs({
        provider: provider,
        manual: true,
        forceCreate: true
      });
      var sync = fs.sync;

      var layout = {
        '/file1': 'contents of file1'
      };
      var finalLayout = {
        '/file1': 'contents of file1',
        '/file2': 'contents of file1'
      };

      sync.once('connected', function onConnected() {
        util.createFilesystemLayout(fs, layout, function(err) {
          expect(err).not.to.exist;

          sync.request();
        });
      });

      sync.once('completed', function onUpstreamCompleted() {
        util.ensureRemoteFilesystem(layout, result.jar, function() {
          fs.symlink('/file1', '/file2', function(err) {
            if (err) throw err;
            sync.once('completed', function onWriteSymlink() {
              util.ensureRemoteFilesystem(finalLayout, result.jar, function() {
                done();
              });
            });

            sync.request();
          });
        });
      });

      sync.connect(util.socketURL, result.token);
    });
  });

});
