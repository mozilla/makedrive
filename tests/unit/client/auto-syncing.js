var expect = require('chai').expect;
var util = require('../../lib/util.js');
var server = require('../../lib/server-utils.js');
var MakeDrive = require('../../../client/src');
var Filer = require('../../../lib/filer.js');

describe('MakeDrive Client - Automatic syncing', function(){
  var syncingEventFired;
  var fs;
  var sync;

  before(function(done) {
    server.start(done);
  });
  after(function(done) {
    server.shutdown(done);
  });

  beforeEach(function() {
    fs = MakeDrive.fs({provider: new Filer.FileSystem.providers.Memory(util.username()), forceCreate: true});
    sync = fs.sync;
    syncingEventFired = false;
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
   * This integration test runs through a normal sync process with options
   * being passed to initiate automatic syncing, as per the desired use case for a
   * non-developer
   */
  it('should complete a sync process with the default time interval', function(done) {
    server.authenticatedConnection(function(err, result) {
      expect(err).not.to.exist;

      var layout = {
        '/file1': 'contents of file1'
      };

      sync.once('connected', function onConnected() {
        util.createFilesystemLayout(fs, layout, function(err) {
          expect(err).not.to.exist;
        });
      });

      sync.once('syncing', function onSyncing() {
        syncingEventFired = true;
      });

      sync.once('completed', function onUpstreamCompleted() {
        // Make sure the file made it to the server
        server.ensureRemoteFilesystem(layout, result.jar, function() {
          sync.disconnect();
        });
      });

      sync.once('disconnected', function onDisconnected() {
        util.deleteFilesystemLayout(fs, null, function(err) {
          expect(err).not.to.exist;

          // Re-sync with server and make sure we get our file back
          sync.once('completed', function onSecondDownstreamSync() {

            sync.once('disconnected', function onSecondDisconnected() {
              util.ensureFilesystem(fs, layout, function(err) {
                expect(err).not.to.exist;
                expect(syncingEventFired).to.be.true;

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

  it('should complete a sync process with a custom time interval', function(done) {
    server.authenticatedConnection(function(err, result) {
      expect(err).not.to.exist;

      var layout = {
        '/file1': 'contents of file1'
      };

      sync.once('connected', function onConnected() {
        sync.auto(10000);

        util.createFilesystemLayout(fs, layout, function(err) {
          expect(err).not.to.exist;
        });
      });

      sync.once('syncing', function onSyncing() {
        syncingEventFired = true;
      });

      sync.once('completed', function onUpstreamCompleted() {
        // Make sure the file made it to the server
        server.ensureRemoteFilesystem(layout, result.jar, function() {
          sync.disconnect();
        });
      });

      sync.once('disconnected', function onDisconnected() {
        util.deleteFilesystemLayout(fs, null, function(err) {
          expect(err).not.to.exist;

          // Re-sync with server and make sure we get our file back
          sync.once('completed', function onSecondDownstreamSync() {

            sync.once('disconnected', function onSecondDisconnected() {
              util.ensureFilesystem(fs, layout, function(err) {
                expect(err).not.to.exist;
                expect(syncingEventFired).to.be.true;

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
