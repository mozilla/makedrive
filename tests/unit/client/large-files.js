var expect = require('chai').expect;
var util = require('../../lib/util.js');
var MakeDrive = require('../../../client/src');
var Filer = require('../../../lib/filer.js');

describe('MakeDrive Client - sync large files', function(){
  var provider;

  beforeEach(function() {
    provider = new Filer.FileSystem.providers.Memory(util.username());
  });
  afterEach(function() {
    provider = null;
  });

  function makeBuffer(n) {
    // Make a Buffer of size n and fill it with 7s (who doesn't like 7?)
    // so that it's different from an empty Buffer of 0s or random garbage.
    var buf = new Filer.Buffer(n * 1024);
    buf.fill(7);
    return buf;
  }

  /**
   * This test creates some large files in a dir, syncs, and checks that
   * they exist on the server. It then removes them, and makes sure a
   * downstream sync brings them back.
   */
  it('should sync large files', function(done) {
    util.authenticatedConnection(function( err, result ) {
      expect(err).not.to.exist;

      var fs = MakeDrive.fs({provider: provider, manual: true});
      var sync = fs.sync;

      // Make a layout with /project and some large files
      var layout = {
        '/project/1': makeBuffer(50),
        '/project/2': makeBuffer(256),
        '/project/3': makeBuffer(512),
        '/project/4': makeBuffer(1024)
      };

      sync.once('connected', function onConnected() {
        util.createFilesystemLayout(fs, layout, function(err) {
          expect(err).not.to.exist;

          sync.request('/');
        });
      });

      sync.once('completed', function onUpstreamCompleted() {
        util.ensureRemoteFilesystem(layout, result.jar, function(err) {
          sync.disconnect();
        });
      });

      sync.once('disconnected', function onDisconnected() {
        util.deleteFilesystemLayout(fs, null, function(err) {
          expect(err).not.to.exist;

          // Re-sync with server and make sure we get our deep dir back
          sync.once('connected', function onSecondDownstreamSync() {

            sync.once('disconnected', function onSecondDisconnected() {
              util.ensureFilesystem(fs, layout, function(err) {
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
