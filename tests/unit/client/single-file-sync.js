var expect = require('chai').expect;
var util = require('../../lib/util.js');
var MakeDrive = require('../../../client/src');
var Filer = require('../../../lib/filer.js');

describe('MakeDrive Client - sync a single file', function(){
  var provider;

  beforeEach(function() {
    provider = new Filer.FileSystem.providers.Memory(util.username());
  });
  afterEach(function() {
    provider = null;
  });

  /**
   * This test creates a single file to confirm that a single file can be synced upstream.
   */
  it('should sync a single specified file', function(done) {
    util.authenticatedConnection(function(err, result) {
      expect(err).not.to.exist;

      var fs = MakeDrive.fs({provider: provider, manual: true, forceCreate: true});
      var sync = fs.sync;

      var fullLayout = {
            '/file1': 'contents of file1',
            '/file2': 'contents of file2'
          },
          expectedLayout = {
            '/file1': 'contents of file1'
          };

      sync.once('connected', function onConnected() {
        util.createFilesystemLayout(fs, fullLayout, function(err) {
          expect(err).not.to.exist;

          sync.request('/file1');
        });
      });

      sync.once('completed', function onUpstreamCompleted() {
        // Make sure only one file made it to the server
        util.ensureRemoteFilesystem(expectedLayout, result.jar, function() {
          sync.disconnect();
        });
      });

      sync.once('disconnected', function onDisconnected() {
        util.deleteFilesystemLayout(fs, null, function(err) {
          expect(err).not.to.exist;

          // Re-sync with server and make sure we get our files back
          sync.once('connected', function onSecondDownstreamSync() {
            sync.once('disconnected', function onSecondDisconnected() {
              util.ensureFilesystem(fs, expectedLayout, function(err) {
                expect(err).not.to.exist;

                done();
              });
            });

            sync.disconnect();
          });

          // Get a new token for this second connection
          util.getWebsocketToken(result, function(err, result) {
            expect(err).not.to.exist;

            sync.connect(util.socketURL, result.token);
          });
        });
      });

      sync.connect(util.socketURL, result.token);
    });
  });
});
