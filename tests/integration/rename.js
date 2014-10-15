var expect = require('chai').expect;
var util = require('../lib/util.js');

describe('MakeDrive Client - file rename integration', function(){
  var client1;
  var client2;
  var layout = {'/dir1/file1': 'data'};

  // Create 2 sync clients, do downstream syncs
  beforeEach(function(done) {
    util.ready(function() {
      var username = util.username();

      util.setupSyncClient({username: username, layout: layout, manual: true}, function(err, client) {
        if(err) throw err;

        client1 = client;
        util.setupSyncClient({username: username, manual: true}, function(err, client) {
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
    client1.sync.once('disconnected', function() {
      client1 = null;

      client2.sync.once('disconnected', function() {
        client2 = null;
        done();
      });

      client2.sync.disconnect();
    });

    client1.sync.disconnect();
  });

  /**
   * This test creates 2 simultaneous clients for the same user, and simulates
   * a situation where a file is renamed by one client. It then makes sure that
   * this renamed file is sync'ed to the other client.
   */
  it('should handle file renames in downstream and upstream syncs', function(done) {
    client2.sync.once('completed', function() {
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

});
