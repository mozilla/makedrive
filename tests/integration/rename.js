var expect = require('chai').expect;
var util = require('../lib/util.js');
var server = require('../lib/server-utils.js');

describe('MakeDrive Client - file rename integration', function(){
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

  /**
   * This test creates 2 simultaneous clients for the same user, and simulates
   * a situation where a file is renamed by one client. It then makes sure that
   * this renamed file is synced to the other client.
   */
  it('should handle file renames in downstream and upstream syncs', function(done) {
    client2.sync.once('synced', function() {
      // Make sure we have a confliced copy now + the new file.
      client2.fs.readdir('/dir1', function(err, entries) {
        if(err) throw err;

        expect(entries.length).to.equal(1);
        expect(entries[0]).to.equal('file2');
        done();
      });
    });

    // Rename the file on client1
    client1.fs.rename('/dir1/file1', '/dir1/file2', function(err) {
      if(err) throw err;

      // Sync client1's change to server
      client1.sync.request();
    });
  });

  it('should be able to rename and end up with single file after renamed', function(done) {
    var originalLayout = {'/dir/file.txt': 'This is file 1'};
    var newLayout = {'/dir/newFile.txt': 'This is file 1'};

    server.setupSyncClient({layout: originalLayout, manual: true}, function(err, client) {
      expect(err).not.to.exist;

      var fs = client.fs;

      fs.rename('/dir/file.txt', '/dir/newFile.txt', function(err) {
        expect(err).not.to.exist;

        client.sync.once('completed', function after() {
          server.ensureRemoteFilesystem(newLayout, client.jar, function(err) {
            expect(err).not.to.exist;

            client.sync.on('disconnected', done);
            client.sync.disconnect();
          });
        });

        client.sync.request();
      });
    });
  });
});
