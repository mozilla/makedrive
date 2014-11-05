var expect = require('chai').expect;
var util = require('../../lib/util.js');
var server = require('../../lib/server-utils.js');
var MakeDrive = require('../../../client/src');
var Filer = require('../../../lib/filer.js');

describe('MakeDrive Client - sync deep tree structure', function(){
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
   * This test creates series of deep dir trees, syncs, and checks that
   * they exist on the server. It then removes them, and makes sure a
   * downstream sync brings them back.
   */
  it('should sync an deep dir structure', function(done) {
    server.authenticatedConnection(function( err, result ) {
      expect(err).not.to.exist;

      // Make a directory 20 levels deep with one file inside.
      var layout = {
        '/1/2/3/4/5/6/7/8/9/10/11/12/13/14/15/16/17/18/19/20/file': 'This is a file'
      };

      sync.once('synced', function onDownstreamCompleted() {
        sync.once('synced', function onUpstreamCompleted() {
          server.ensureRemoteFilesystem(layout, result.jar, function(err) {
            expect(err).not.to.exist;
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

          // Re-sync with server and make sure we get our deep dir back
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
