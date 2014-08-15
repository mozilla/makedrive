var expect = require('chai').expect;
var util = require('../lib/util.js');
var MakeDrive = require('../../client/src');
var Filer = require('../../lib/filer.js');

describe('MakeDrive Memory Leak', function(){
  var client1;
  var client2;

  // Cleanly shut down both clients
  afterEach(function(done) {
    if(client1) {
      client1.sync.once('disconnected', function() {
        client1 = null;

        client2.sync.once('disconnected', function() {
          client2 = null;
          done();
        });

        client2.sync.disconnect();
      });

      client1.sync.disconnect();
    }
  });

  function randomBuffer(size) {
    var buf = new Buffer(size);
    buf.fill(Date.now());
    return buf;
  }

  it('should not leak', function(done) {
    var username = util.username();

    // Create a series of dirs with ~400K binary files in each for client 1
    var layout = {};
    var path;
    for(var i = 0; i < 100; i++) {
      path = '/dir' + i + '/image';
      layout[path] = randomBuffer(400 * 1024 * 1024);
    }

    util.setupSyncClient({username: username, layout: layout}, function(err, client) {
      if(err) throw err;

      client1 = client;

      client1.sync.once('completed', function() {
        // Make sure the remote filesystem is what we expect
        util.ensureRemoteFilesystem(layout, client.jar, function(err) {
          if(err) throw err;

          // Now do the initial downsteam sync of all that data from client 1
          // which will probably leak.
          util.setupSyncClient({username: username}, function(err, client) {
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

      // Sync client1's change to server
      client1.sync.request();
    });
  });
});
