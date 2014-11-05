var expect = require('chai').expect;
var util = require('../../lib/util.js');
var server = require('../../lib/server-utils.js');
var MakeDrive = require('../../../client/src');
var Filer = require('../../../lib/filer.js');

describe('MakeDrive Client - sync empty dir', function(){
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
   * This test creates an empty dir, syncs, and checks that it exists
   * on the server. It then removes it, and makes sure a downstream sync
   * brings it back.
   */
  it('should sync an empty dir', function(done) {
    server.authenticatedConnection(function(err, result) {
      expect(err).not.to.exist;

      var layout = {'/empty': null};

      sync.once('synced', function onDownstreamCompleted() {
        util.createFilesystemLayout(fs, layout, function(err) {
          expect(err).not.to.exist;

          sync.request();
        });
      });

      sync.once('completed', function onUpstreamCompleted() {
        server.ensureRemoteFilesystem(layout, result.jar, function() {
          sync.disconnect();
        });
      });

      sync.once('disconnected', function onDisconnected() {
        util.deleteFilesystemLayout(fs, null, function(err) {
          expect(err).not.to.exist;

          // Re-sync with server and make sure we get our empty dir back
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
