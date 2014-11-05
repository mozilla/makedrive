var expect = require('chai').expect;
var util = require('../lib/util.js');
var server = require('../lib/server-utils.js');

describe('MakeDrive Client - file delete integration', function(){
  var client1;
  var client2;
  var layout = {'/dir1/file1': 'data'};

  before(function(done) {
    server.start(done);
  });
  after(function(done) {
    server.shutdown(done);
  });

  // Create 2 sync clients, do downstream syncs
  beforeEach(function(done) {
    server.run(function() {
      var username = util.username();

      server.setupSyncClient({username: username, layout: layout, manual: true}, function(err, client) {
        if(err) throw err;

        client1 = client;
        server.setupSyncClient({username: username, manual: true}, function(err, client) {
          if(err) throw err;

          client2 = client;

          // Make sure the initial downstream sync produced the same layout as client1
          util.ensureFilesystem(client2.fs, layout, function(err) {
            if(err) throw err;

            done();
          });
        });
      });
    });
  });

  // Cleanly shut down both clients
  afterEach(function(done) {
    util.disconnectClient(client1.sync, function(err) {
      if(err) throw err;

      client1 = null;

      util.disconnectClient(client2.sync, function(err) {
        if(err) throw err;

        client2 = null;

        done();
      });
    });
  });

  /*
   * This test creates 2 simultaneous clients for the same user, and simulates
   * a situation where a file is deleted by one client. It then makes sure that
   * this deleted file is synced to the other client.
  */
  it('should handle file deletes in downstream and upstream syncs', function(done) {
    var finalLayout = {'/dir1': null};

    // 2: Client2 gets the delete command from the server
    client2.sync.once('synced', function() {
      util.ensureFilesystem(client2.fs, finalLayout, function(err) {
        expect(err).not.to.exist;

        client1.sync.once('disconnected', function() {
          server.getWebsocketToken(client1, function(err, result) {
            if(err) throw err;

            // 4: Client1 connects back
            client1.sync.connect(server.socketURL, result.token);
          });
        });

        // 3: Client1 disconnects
        client1.sync.disconnect();
      });
    });

    // 1: Sync client1's delete to the server
    client1.sync.once('synced', function() {
      util.ensureFilesystem(client1.fs, finalLayout, function(err) {
        expect(err).not.to.exist;

        server.ensureRemoteFilesystem(finalLayout, client1.jar, function(err) {
          expect(err).not.to.exist;

          // 5: Expect that the file is not downstreamed back from the server
          client1.sync.once('synced', function() {
            util.ensureFilesystem(client1.fs, finalLayout, function(err) {
              expect(err).not.to.exist;
              done();
            });
          });
        });
      });
    });

    // Delete the file on client1
    client1.fs.unlink('/dir1/file1', function(err) {
      if(err) throw err;

      client1.sync.request();
    });
  });
});
