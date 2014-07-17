var expect = require('chai').expect;
var util = require('../../lib/util.js');
var MakeDrive = require('../../../client/src');
var Filer = require('../../../lib/filer.js');

describe('MakeDrive Client API', function(){
  var provider;

  beforeEach(function() {
    provider = new Filer.FileSystem.providers.Memory(util.username());
  });
  afterEach(function() {
    provider = null;
  });

  it('should have expected methods and properites', function() {
    // Bits copied from Filer
    expect(MakeDrive.Buffer).to.be.a.function;
    expect(MakeDrive.Path).to.exist;
    expect(MakeDrive.Path.normalize).to.be.a.function;
    expect(MakeDrive.Errors).to.exist;

    // MakeDrive.fs()
    expect(MakeDrive.fs).to.be.a.function;
    var fs = MakeDrive.fs({memory: true, manual: true});
    var fs2 = MakeDrive.fs({memory: true, manual: true});
    expect(fs).to.equal(fs2);

    // MakeDrive.fs().sync property
    expect(fs.sync).to.exist;
    expect(fs.sync.on).to.be.a.function;
    expect(fs.sync.off).to.be.a.function;
    expect(fs.sync.connect).to.be.a.function;
    expect(fs.sync.disconnect).to.be.a.function;
    expect(fs.sync.sync).to.be.a.function;

    // Sync States
    expect(fs.sync.SYNC_DISCONNECTED).to.equal(0);
    expect(fs.sync.SYNC_CONNECTING).to.equal(1);
    expect(fs.sync.SYNC_CONNECTED).to.equal(2);
    expect(fs.sync.SYNC_SYNCING).to.equal(3);
    expect(fs.sync.SYNC_ERROR).to.equal(4);
    expect(fs.sync.state).to.equal(fs.sync.SYNC_DISCONNECTED);
  });

  /**
   * This test goes through the complete process of syncing with the server.
   * It starts by connecting, then writes a file and tries to sync. The
   * various sync events are observed, then it disconnects, and finally
   * checks that the file was uploaded, and is available via the /p/ route.
   */
  it('should go through proper steps with connect(), request(), disconnect()', function(done) {
    util.authenticatedConnection(function( err, result ) {
      expect(err).not.to.exist;

      var token = result.token;

      var filename = '/file';
      var fileData = 'data';

      var fs = MakeDrive.fs({provider: provider, manual: true});
      var sync = fs.sync;

      var everSeenSyncing = false;
      var everSeenCompleted = false;
      var everSeenError = false;

      sync.once('connected', function onConnected() {
        expect(sync.state).to.equal(sync.SYNC_CONNECTED);

        // Write a file and try to sync
        fs.writeFile(filename, fileData, function(err) {
          expect(err).not.to.exist;
          sync.request('/');
        });
      });

      sync.once('syncing', function onUpstreamSyncing() {
        everSeenSyncing = sync.state;
      });

      sync.once('completed', function onUpstreamCompleted() {
        everSeenCompleted = sync.state;
        sync.disconnect();
      });

      sync.on('error', function onError(err) {
        // Remember any errors we see--should be none
        everSeenError = err;
      });

      sync.once('disconnected', function onDisconnected() {
        expect(everSeenError).to.be.false;
        if(everSeenError) {
          console.error("Error was:", everSeenError);
        }

        expect(sync.state).to.equal(sync.SYNC_DISCONNECTED);
        expect(everSeenSyncing).to.equal(sync.SYNC_SYNCING);
        expect(everSeenCompleted).to.equal(sync.SYNC_CONNECTED);

        // Confirm file was really uploaded using /p route
        util.ensureFile(filename, fileData, result.jar, done);
      });

      expect(sync.state).to.equal(sync.SYNC_DISCONNECTED);
      sync.connect(util.socketURL, token);
      expect(sync.state).to.equal(sync.SYNC_CONNECTING);
    });
  });

});
