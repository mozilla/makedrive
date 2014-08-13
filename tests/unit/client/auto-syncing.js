/*jshint expr: true*/

var expect = require('chai').expect;
var util = require('../../lib/util.js');
var MakeDrive = require('../../../client/src');
var Filer = require('../../../lib/filer.js');

describe('MakeDrive Client - Automatic syncing', function(){
  var provider;
  var syncingEventFired;

  beforeEach(function() {
    provider = new Filer.FileSystem.providers.Memory(util.username());
    syncingEventFired = false;
  });
  afterEach(function() {
    provider = null;
  });

  /**
   * This integration test runs through a normal sync process with options
   * being passed to initiate automatic syncing, as per the desired use case for a
   * non-developer
   */
  it('should complete a sync process with the default time interval', function(done) {
    util.authenticatedConnection(function( err, result ) {
      expect(err).not.to.exist;

      var fs = MakeDrive.fs({provider: provider, forceCreate: true});
      var sync = fs.sync;

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
        util.ensureRemoteFilesystem(layout, result.jar, function() {
          sync.disconnect();
        });
      });

      sync.once('disconnected', function onDisconnected() {
        util.deleteFilesystemLayout(fs, null, function(err) {
          expect(err).not.to.exist;

          // Re-sync with server and make sure we get our file back
          sync.once('connected', function onSecondDownstreamSync() {

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
          util.getWebsocketToken(result, function(err, result) {
            expect(err).not.to.exist;

            sync.connect(util.socketURL, result.token);
          });
        });
      });

      sync.connect(util.socketURL, result.token);
    });
  });

  it('should complete a sync process with a custom time interval', function(done) {
    util.authenticatedConnection(function( err, result ) {
      expect(err).not.to.exist;

      var fs = MakeDrive.fs({provider: provider, interval: 10000, forceCreate: true});
      var sync = fs.sync;

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
        util.ensureRemoteFilesystem(layout, result.jar, function() {
          sync.disconnect();
        });
      });

      sync.once('disconnected', function onDisconnected() {
        util.deleteFilesystemLayout(fs, null, function(err) {
          expect(err).not.to.exist;

          // Re-sync with server and make sure we get our file back
          sync.once('connected', function onSecondDownstreamSync() {

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
