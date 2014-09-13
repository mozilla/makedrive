var expect = require('chai').expect;
var util = require('../../lib/util.js');
var MakeDrive = require('../../../client/src');
var Filer = require('../../../lib/filer.js');

describe('Syncing when a file already exists on the client', function(){
  var provider1;

  beforeEach(function() {
    var username = util.username();
    provider1 = new Filer.FileSystem.providers.Memory(username);
  });
  afterEach(function() {
    provider1 = null;
  });

  it('should be able to sync when the client already has a file and is performing an initial downstream sync', function(done) {
    var fs1 = MakeDrive.fs({provider: provider1, manual: true, forceCreate: true});
    var everError = false;

    // 1. Write some file on local filesystem.
    fs1.writeFile('/abc.txt', 'this is a simple file', function(err) {
      if(err) throw err;

      // 2. try to connect after successfully changing the local filesystem
      util.authenticatedConnection(function(err, result1) {
        if(err) throw err;
        var sync1 = fs1.sync;

        // 4. should not have any error after trying to connect to the server.
        sync1.once('error', function error(err) {
          everError = err;
        });

        sync1.once('connected', function connected() {
          expect(everError).to.be.false;
          done();
        });

        // 3. try and conect to the server
        sync1.connect(util.socketURL, result1.token);
      });
    });
  });
});
