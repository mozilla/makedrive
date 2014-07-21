var expect = require('chai').expect;
var util = require('../../lib/util.js');
var MakeDrive = require('../../../client/src');
var Filer = require('../../../lib/filer.js');

describe('MakeDrive Client - sync empty dir', function(){
  var provider;

  beforeEach(function() {
    provider = new Filer.FileSystem.providers.Memory(util.username());
  });
  afterEach(function() {
    provider = null;
  });

  /**
   * This test creates an empty dir, syncs, and checks that it exists
   * on the server. It then removes it, and makes sure a downstream sync
   * brings it back.
   */
  it('should sync an empty dir', function(done) {
    util.authenticatedConnection(function( err, result ) {
      expect(err).not.to.exist;

      var fs = MakeDrive.fs({provider: provider, manual: true});
      var sync = fs.sync;

      var layout = {'/empty': null};

      sync.once('connected', function onConnected() {
        util.createFilesystemLayout(fs, layout, function(err) {
          expect(err).not.to.exist;

          sync.request('/');
        });
      });

      sync.once('completed', function onUpstreamCompleted() {
        util.ensureRemoteFilesystem(layout, result.jar, function() {
          sync.disconnect();
        });
      });

      sync.once('disconnected', function onDisconnected() {
        util.deleteFilesystemLayout(fs, null, function(err) {
          expect(err).not.to.exist;

          // Re-sync with server and make sure we get our empty dir back
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
