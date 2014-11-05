var expect = require('chai').expect;
var util = require('../../lib/util.js');
var server = require('../../lib/server-utils.js');
var MakeDrive = require('../../../client/src');
var Filer = require('../../../lib/filer.js');

describe('Syncing when a file already exists on the client', function(){
  var fs;
  var sync;
  var username;

  before(function(done) {
    server.start(done);
  });
  after(function(done) {
    server.shutdown(done);
  });

  beforeEach(function() {
    username = util.username();
    fs = MakeDrive.fs({provider: new Filer.FileSystem.providers.Memory(username), manual: true, forceCreate: true});
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

  it('should be able to sync when the client already has a file and is performing an initial downstream sync', function(done) {
    var everError = false;

    // 1. Write some file on local filesystem.
    fs.writeFile('/abc.txt', 'this is a simple file', function(err) {
      if(err) throw err;

      server.upload(username, '/file', 'This is a file that should be downstreamed', function(err){
        if(err) throw err;

        // 2. try to connect after successfully changing the local filesystem
        server.authenticatedConnection({username: username}, function(err, result) {
          if(err) throw err;

          // 4. should not have any error after trying to connect to the server.
          sync.once('error', function error(err) {
            everError = err;
          });

          sync.once('completed', function completed(path) {
            expect(path).to.equal('/file');
            expect(everError).to.be.false;
            done();
          });

          sync.once('synced', function synced() {
            expect(true, 'Makedrive should not be completely synced').to.be.false;
          });

          // 3. try and conect to the server
          sync.connect(server.socketURL, result.token);
        });
      });
    });
  });
});
