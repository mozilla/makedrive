var expect = require('chai').expect;
var util = require('../../lib/util.js');
var server = require('../../lib/server-utils.js');
var MakeDrive = require('../../../client/src');
var Filer = require('../../../lib/filer.js');

describe('MakeDrive Client - sync multiple files', function(){
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
   * This test creates multiple files, syncs, and checks that they exist
   * on the server. It then removes them, and makes sure a downstream sync
   * brings them back.
   */
  it('should sync multiple files', function(done) {
    server.authenticatedConnection(function( err, result ) {
      expect(err).not.to.exist;

      var layout = {
        '/file1': 'contents of file1',
        '/file2': 'contents of file2',
        '/file3': 'contents of file3'
      };

      sync.once('synced', function onDownstreamCompleted() {
        sync.once('synced', function onUpstreamCompleted() {
          // Make sure all 3 files made it to the server
          server.ensureRemoteFilesystem(layout, result.jar, function() {
            sync.disconnect();
          });
        });

        util.createFilesystemLayout(fs, layout, function(err) {
          expect(err).not.to.exist;

          sync.request();
        });
      });

      sync.once('disconnected', function onDisconnected() {
        util.deleteFilesystemLayout(fs, null, function(err) {
          expect(err).not.to.exist;

          // Re-sync with server and make sure we get our files back
          sync.once('synced', function onSecondDownstreamSync() {

            sync.once('disconnected', function onSecondDisconnected() {
              util.ensureFilesystem(fs, layout, function(err) {
                expect(err).not.to.exist;

                done();
              });
            });

            sync.disconnect();
          });

          // Get a new token for this second connection
          server.getWebsocketToken(result, function(err, result) {
            expect(err).not.to.exist;

            sync.connect(server.socketURL, result.token);
          });
        });
      });

      sync.connect(server.socketURL, result.token);
    });
  });

});
