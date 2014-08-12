var expect = require('chai').expect;
var util = require('../lib/util.js');
var MakeDrive = require('../../client/src');
var Filer = require('../../lib/filer.js');

describe('Two clients', function(){
  var provider1, provider2;

  beforeEach(function() {
  	var username = util.username();
    provider1 = new Filer.FileSystem.providers.Memory(username + '_1');
    provider2 = new Filer.FileSystem.providers.Memory(username + '_2');
  });
  afterEach(function() {
    provider1 = null;
    provider2 = null;
  });

  it('should be able to sync two files in one-direction', function(done) {
  	var file1 = {'/dir/file1.txt': 'This is file 1'};
  	var file2 = {'/dir/file2.txt': 'This is file 2'};
  	var finalLayout = {};

  	for(var k in file1) finalLayout[k] = file1[k];
		for(var k in file2) finalLayout[k] = file2[k];

  	util.authenticatedConnection(function(err, result1) {
      expect(err).not.to.exist;

      var fs1 = MakeDrive.fs({provider: provider1, manual: true, forceCreate: true});
      var sync1 = fs1.sync;

      sync1.once('connected', function() {
      	util.authenticatedConnection({username: result1.username}, function(err, result2) {
	      	expect(err).not.to.exist;

		      var fs2 = MakeDrive.fs({provider: provider2, manual: true, forceCreate: true});
		      var sync2 = fs2.sync;

		      sync2.once('connected', function() {
		      	sync1.once('completed', function() {
		      		util.ensureRemoteFilesystem(file1, result1.jar, function(err) {
		      			expect(err).not.to.exist;
		      		});
		      	});

		      	sync2.once('completed', function() {
		      		util.ensureFilesystem(fs2, file1, function(err) {
		      			expect(err).not.to.exist;

		      			sync1.once('completed', function() {
		      				util.ensureRemoteFilesystem(finalLayout, result1.jar, function(err) {
				      			expect(err).not.to.exist;
				      		});
		      			});

		      			sync2.once('completed', function() {
		      				util.ensureFilesystem(fs2, finalLayout, function(err) {
		      					expect(err).not.to.exist;

		      					done();
		      				});
		      			});

		      			util.createFilesystemLayout(fs1, file2, function(err) {
		      				expect(err).not.to.exist;

		      				sync1.request();
		      			});
		      		});
		      	});

		      	util.createFilesystemLayout(fs1, file1, function(err) {
			      	expect(err).not.to.exist;

			      	sync1.request();
			      });
		      });

		      sync2.connect(util.socketURL, result2.token);
	      });
      });

      sync1.connect(util.socketURL, result1.token);
    });
  });
});
