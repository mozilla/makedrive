var expect = require('chai').expect;
var util = require('../lib/util.js');

describe('Renaming a file', function(){
  it('should be able to rename and end up with single file after renamed', function(done) {
    var originalLayout = {'/dir/file.txt': 'This is file 1'};
    var newLayout = {'/dir/newFile.txt': 'This is file 1'};

    util.setupSyncClient({layout: originalLayout, manual: true}, function(err, client) {
      expect(err).not.to.exist;

      var fs = client.fs;

      fs.rename('/dir/file.txt', '/dir/newFile.txt', function(err) {
        expect(err).not.to.exist;

        client.sync.once('completed', function after() {
          util.ensureRemoteFilesystem(newLayout, client.jar, function(err) {
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
