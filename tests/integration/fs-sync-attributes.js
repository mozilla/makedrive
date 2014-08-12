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
  	var fs1, fs2;
  	var client1, client2;
	  var layout = {};
    var finalLayout1 = {};
    var finalLayout2 = {};
    var partialLayout = {};
    var finalPath1Layout = {};
    var finalPath2Layout = {};
    var finalPath1Layout2 = {};

    function onConnected1() {
    	console.log('session id 1:', result1.token);
    	// Step 5: Create /dir/myfile.txt for client 1
    	util.createFilesystemLayout(fs1, layout, function(err) {
    		expect(err).not.to.exist;

    		checkUnsyncedAttr(fs1, layout, true, function(err, unsynced) {
          expect(err).not.to.exist;
          expect(unsynced).to.be.true;

          // Step 6: Request a sync for client 1
          client1.request();
        });
    	});
    }

    function onUpstreamCompleted1() {
    	function onDownstreamCompleted1() {
    		function onSecondDownstreamCompleted1() {
    			function onThirdDownstreamCompleted1() {
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
      		}

      		finalPath1Layout[paths[0]] = finalLayout1[paths[0]];

      		// Step 22: Client 1 recieves changes to /dir/myfile2.txt
      		client1.once('completed', onThirdDownstreamCompleted1);

      		util.ensureFilesystem(fs1, layout, function(err) {
      			expect(err).not.to.exist;

      			checkUnsyncedAttr(fs1, layout, false, function(err, synced) {
      				expect(err).not.to.exist;
      				expect(synced).to.be.true;

      				// Step 18: Client 1 modifiees /dir/myfile.txt
      				fs1.writeFile(paths[0], finalLayout1[paths[0]], function(err) {
      					expect(err).not.to.exist;

      					checkUnsyncedAttr(fs1, finalPath1Layout, true, function(err, unsynced) {
      						expect(err).not.to.exist;
      						expect(unsynced).to.be.true;

      						checkUnsyncedAttr(fs1, partialLayout, false, function(err, synced) {
      							expect(err).not.to.exist;
      							expect(synced).to.be.true;

      							// Step 19: Client 2 modifies /dir/myfile2.txt
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

            							// Step 20: Client 2 requests a sync
            							client2.request();
            						});
            					});
      							});
      						});
      					});
      				});
      			});
      		});
      	}

    		// Step 17: Client 1 receives /dir/myfile2.txt
      	client1.once('completed', onSecondDownstreamCompleted1);

      	util.ensureFilesystem(fs1, layout, function(err) {
      		expect(err).not.to.exist;

      		checkUnsyncedAttr(fs1, layout, false, function(err, synced) {
      			expect(err).not.to.exist;
      			expect(synced).to.be.true;

      			// Step 14: Client 2 creates /dir/myfile2.txt
      			fs2.writeFile(paths[1], partialLayout[paths[1]], function(err) {
      				expect(err).not.to.exist;

      				checkUnsyncedAttr(fs2, partialLayout, true, function(err, unsynced) {
          			expect(err).not.to.exist;
          			expect(unsynced).to.be.true;

          			// Step 15: Client 2 requests a sync
          			client2.request();
          		});
      			});
      		});
      	});
      }

      function onUpstreamCompleted2() {
      	function onSecondUpstreamCompleted2() {
      		function onThirdUpstreamCompleted2() {
      			util.ensureRemoteFilesystem(finalLayout2, result2.jar, function(err) {
      				expect(err).not.to.exist;

      				checkUnsyncedAttr(fs2, finalLayout2, false, function(err, synced) {
      					expect(err).not.to.exist;
      					expect(synced).to.be.true;
      				});
      			});
      		}

      		// Step 21: Client 2 has finished third upstream sync
      		client2.once('completed', onThirdUpstreamCompleted2);

      		for(var path in partialLayout) layout[path] = partialLayout[path];

      		util.ensureRemoteFilesystem(layout, result2.jar, function(err) {
        		expect(err).not.to.exist;

        		checkUnsyncedAttr(fs2, layout, false, function(err, synced) {
        			expect(err).not.to.exist;
        			expect(synced).to.be.true;
        		});
        	});
      	}

      	// Step 16: Client 2 has finished second upstream sync
      	client2.once('completed', onSecondUpstreamCompleted2);

      	util.ensureRemoteFilesystem(layout, result2.jar, function(err) {
      		expect(err).not.to.exist;

      		checkUnsyncedAttr(fs2, layout, false, function(err, synced) {
      			expect(err).not.to.exist;
      			expect(synced).to.be.true;
      		});
      	});
      }

      // Step 13: Client 1 receives changes to /dir/myfile.txt
    	client1.once('completed', onDownstreamCompleted1);

    	// Step 12: Client 2 has finished first upstream sync
      client2.once('completed', onUpstreamCompleted2);

    	// Step 9: Client 2 has connected
      client2.once('connected', onConnected2);

    	partialLayout[paths[1]] = 'This is a second file';

    	util.ensureRemoteFilesystem(layout, result1.jar, function(err) {
    		expect(err).not.to.exist;

    		checkUnsyncedAttr(fs1, layout, false, function(err, synced) {
    			expect(err).not.to.exist;
          expect(synced).to.be.true;

					// Step 8: Connect second client
          client2.connect(util.socketURL, result2.token);
    		});
    	});
    }

    function onConnected2() {
    	console.log('session id 2:', result2.token);
    	util.ensureFilesystem(fs2, layout, function(err) {
    		expect(err).not.to.exist;

    		checkUnsyncedAttr(fs2, layout, false, function(err, synced) {
    			expect(err).not.to.exist;
          expect(synced).to.be.true;

          layout[paths[0]] = 'Changed content';

          // Step 10: Client 2 modifies /dir/myfile.txt
          fs2.writeFile(paths[0], layout[paths[0]], function(err) {
          	expect(err).not.to.exist;

          	checkUnsyncedAttr(fs2, layout, true, function(err, unsynced) {
	      			expect(err).not.to.exist;
	            expect(unsynced).to.be.true;

	            // Step 11: Client 2 requests a sync
	            client2.request();
	          });
          });
        });
    	});
    }

  	// Step 1: Create a user and get a token for client 1
  	util.authenticatedConnection(function(err, result1) {
  		expect(err).not.to.exist;

  		fs1 = MakeDrive.fs({provider: provider, manual: true, forceCreate: true});
      client1 = fs1.sync;

      // Step 2: Get a token for client 2
  		util.getWebsocketToken(result1, function(err, result2) {
  			expect(err).not.to.exist;

  			fs2 = MakeDrive.fs({provider: provider, manual: true, forceCreate: true});
	      client2 = fs2.sync;
	      layout[paths[0]] = 'This is a file';
	      finalLayout1[paths[0]] = 'This is the final modification';
	      finalLayout1[paths[1]] = 'This is a second file';
	      finalLayout2[paths[0]] = 'Changed content';
	      finalLayout2[paths[0]] = 'The second file was modified';

	      // Step 4: Client 1 has connected
	      client1.once('connected', onConnected1);

	      // Step 7: Client 1 has finished first upstream sync
	      client1.once('completed', onUpstreamCompleted1);

				// Step 3: Connect first client
	      client1.connect(util.socketURL, result1.token);
  		});
  	});
  });
});