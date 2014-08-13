/*jshint expr: true*/

var expect = require('chai').expect;
var util = require('../../lib/util.js');
var MakeDrive = require('../../../client/src');
var Filer = require('../../../lib/filer.js');

describe('MakeDrive Client - sync deep tree structure', function(){
  var provider;

  beforeEach(function() {
    provider = new Filer.FileSystem.providers.Memory(util.username());
  });
  afterEach(function() {
    provider = null;
  });

  /**
   * This test creates series of deep dir trees, syncs, and checks that
   * they exist on the server. It then removes them, and makes sure a
   * downstream sync brings them back.
   */
  it('should sync an deep dir structure', function(done) {
    util.authenticatedConnection(function( err, result ) {
      expect(err).not.to.exist;

      var fs = MakeDrive.fs({provider: provider, manual: true, forceCreate: true});
      var sync = fs.sync;

      // Make a directory 20 levels deep with one file inside.
      var layout = {
        '/1/2/3/4/5/6/7/8/9/10/11/12/13/14/15/16/17/18/19/20/file': 'This is a file'
      };

      sync.once('connected', function onConnected() {
        util.createFilesystemLayout(fs, layout, function(err) {
          expect(err).not.to.exist;

          sync.request();
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
