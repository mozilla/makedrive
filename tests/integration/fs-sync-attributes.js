var expect = require('chai').expect;
var util = require('../lib/util.js');
var MakeDrive = require('../../client/src');
var Filer = require('../../lib/filer.js');
var checkUnsyncedAttr = require('../lib/unsynced-attr.js');

describe('The \'unsynced\' attribute', function() {
  var provider;
  var paths = ['/dir/myfile.txt', '/dir/myfile2.txt'];

  beforeEach(function() {
    provider = new Filer.FileSystem.providers.Memory(util.username());
  });
  afterEach(function() {
    provider = null;
  });

  it('should be applied to nodes according to their sync state in the filesystem', function(done) {
  	util.authenticatedConnection(function(err, result1) {
  		expect(err).not.to.exist;

  		var fs1 = MakeDrive.fs({provider: provider, manual: true, forceCreate: true});
      var client1 = fs1.sync;

  		util.getWebsocketToken(result1, function(err, result2) {
  			expect(err).not.to.exist;

  			var fs2 = MakeDrive.fs({provider: provider, manual: true, forceCreate: true});
	      var client2 = fs2.sync;
	      var layout = {};
	      var finalLayout1 = {};
	      var finalLayout2 = {};
	      layout[paths[0]] = 'This is a file';
	      finalLayout1[paths[0]] = 'This is the final modification';
	      finalLayout1[paths[1]] = 'This is a second file';
	      finalLayout2[paths[0]] = 'Changed content';
	      finalLayout2[paths[0]] = 'The second file was modified';

	      client1.once('connected', function onConnected1() {
	      	console.log('session id 1:', result1.token);
	      	util.createFilesystemLayout(fs1, layout, function(err) {
	      		expect(err).not.to.exist;

	      		checkUnsyncedAttr(fs1, layout, true, function(err, unsynced) {
	            expect(err).not.to.exist;
	            expect(unsynced).to.be.true;

	            client1.request();
	          });
	      	});
	      });

	      client1.once('completed', function onUpstreamCompleted1() {
	      	client1.once('completed', function onDownstreamCompleted1() {
          	client1.once('completed', function onSecondDownstreamCompleted1() {
          		var finalPath1Layout = {};
          		finalPath1Layout[paths[0]] = finalLayout1[paths[0]];

          		client1.once('completed', function onThirdDownstreamCompleted1() {
          			util.ensureFilesystem(fs1, finalLayout1, function(err) {
          				expect(err).not.to.exist;

          				checkUnsyncedAttr(fs1, finalPath1Layout, true, function(err, unsynced) {
          					expect(err).not.to.exist;
          					expect(unsynced).to.be.true;

          					delete finalLayout1[paths[0]];

          					checkUnsyncedAttr(fs1, finalLayout1, false, function(err, synced) {
          						expect(err).not.to.exist;
          						expect(synced).to.be.true;

          						done();
          					});
          				});
          			});
          		});

          		util.ensureFilesystem(fs1, layout, function(err) {
          			expect(err).not.to.exist;

          			checkUnsyncedAttr(fs1, layout, false, function(err, synced) {
          				expect(err).not.to.exist;
          				expect(synced).to.be.true;

          				fs1.writeFile(paths[0], finalLayout1[paths[0]], function(err) {
          					expect(err).not.to.exist;

          					checkUnsyncedAttr(fs1, finalPath1Layout, true, function(err, unsynced) {
          						expect(err).not.to.exist;
          						expect(unsynced).to.be.true;

          						checkUnsyncedAttr(fs1, partialLayout, false, function(err, synced) {
          							expect(err).not.to.exist;
          							expect(synced).to.be.true;

          							fs2.writeFile(paths[1], finalLayout2[paths[1]], function(err) {
          								expect(err).not.to.exist;

          								var finalPath2Layout = {};
          								var finalPath1Layout2 = {};
          								finalPath2Layout[paths[1]] = finalLayout2[paths[1]];
          								finalPath1Layout2[paths[0]] = finalLayout2[paths[0]];

          								checkUnsyncedAttr(fs2, finalPath2Layout, true, function(err, unsynced) {
		            						expect(err).not.to.exist;
		            						expect(unsynced).to.be.true;

		            						checkUnsyncedAttr(fs2, finalPath1Layout2, false, function(err, synced) {
		            							expect(err).not.to.exist;
		            							expect(synced).to.be.true;

		            							client2.request();
		            						});
		            					});
          							});
          						});
          					});
          				});
          			});
          		});
          	});

          	util.ensureFilesystem(fs1, layout, function(err) {
          		expect(err).not.to.exist;

          		checkUnsyncedAttr(fs1, layout, false, function(err, synced) {
          			expect(err).not.to.exist;
          			expect(synced).to.be.true;

          			fs2.writeFile(paths[1], partialLayout[paths[1]], function(err) {
          				expect(err).not.to.exist;

          				checkUnsyncedAttr(fs2, partialLayout, true, function(err, unsynced) {
	            			expect(err).not.to.exist;
	            			expect(unsynced).to.be.true;

	            			client2.request();
	            		});
          			});
          		});
          	});
          });

	      	var partialLayout = {};
	      	partialLayout[paths[1]] = 'This is a second file';

	      	util.ensureRemoteFilesystem(layout, result1.jar, function(err) {
	      		expect(err).not.to.exist;

	      		checkUnsyncedAttr(fs1, layout, false, function(err, synced) {
	      			expect(err).not.to.exist;
	            expect(synced).to.be.true;

	            client2.once('connected', function onConnected2() {
	            	console.log('session id 2:', result2.token);
	            	util.ensureFilesystem(fs2, layout, function(err) {
	            		expect(err).not.to.exist;

	            		checkUnsyncedAttr(fs2, layout, false, function(err, synced) {
				      			expect(err).not.to.exist;
				            expect(synced).to.be.true;

				            layout[paths[0]] = 'Changed content';

				            fs2.writeFile(paths[0], layout[paths[0]], function(err) {
				            	expect(err).not.to.exist;

				            	checkUnsyncedAttr(fs2, layout, true, function(err, unsynced) {
						      			expect(err).not.to.exist;
						            expect(unsynced).to.be.true;

						            client2.request();
						          });
				            });
				          });
	            	});
	            });

	            client2.once('completed', function onUpstreamCompleted2() {
	            	console.log('upstream completed');
	            	client2.once('completed', function onSecondUpstreamCompleted2() {
	            		client2.once('completed', function onThirdUpstreamCompleted2() {
	            			util.ensureRemoteFilesystem(finalLayout2, result2.jar, function(err) {
	            				expect(err).not.to.exist;

	            				checkUnsyncedAttr(fs2, finalLayout2, false, function(err, synced) {
	            					expect(err).not.to.exist;
	            					expect(synced).to.be.true;
	            				});
	            			});
	            		});

	            		for(var path in partialLayout) layout[path] = partialLayout[path];

	            		util.ensureRemoteFilesystem(layout, result2.jar, function(err) {
		            		expect(err).not.to.exist;

		            		checkUnsyncedAttr(fs2, layout, false, function(err, synced) {
		            			expect(err).not.to.exist;
		            			expect(synced).to.be.true;
		            		});
		            	});
	            	});

	            	util.ensureRemoteFilesystem(layout, result2.jar, function(err) {
	            		expect(err).not.to.exist;

	            		checkUnsyncedAttr(fs2, layout, false, function(err, synced) {
	            			expect(err).not.to.exist;
	            			expect(synced).to.be.true;
	            		});
	            	});
	            });

	            client2.connect(util.socketURL, result2.token);
	      		});
	      	});
	      });

	      client1.connect(util.socketURL, result1.token);
  		});
  	});
  });
});