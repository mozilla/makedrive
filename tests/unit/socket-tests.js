var expect = require('chai').expect;
var util = require('../lib/util.js');
var SyncMessage = require('../../lib/syncmessage');
var Sync = require('../../server/lib/sync');
var deserialize = require('../../lib/diff').deserialize;

var env = require('../../server/lib/environment');

describe('[Downstream Syncing with Websockets]', function(){
 describe('The server', function(){
   it('should close a socket if bad data is sent in place of websocket-auth token', function(done) {
     util.authenticatedConnection({ done: done }, function( err, result ) {
       expect(err).not.to.exist;

       var gotMessage = false;

       var socketPackage = util.openSocket({
         onMessage: function() {
           gotMessage = true;
         },
         onClose: function() {
           expect(gotMessage).to.be.false;
           util.cleanupSockets(result.done, socketPackage);
         },
         onOpen: function() {
           socketPackage.socket.send("this-is-garbage");
         }
       });
     });
   });

   it('shouldn\'t allow the same token to be used twice', function(done) {
     util.authenticatedConnection({ done: done }, function( err, result ) {
       expect(err).not.to.exist;
       var socketData = {
         token: result.token
       };

       var socketPackage = util.openSocket(socketData, {
         onMessage: function(message) {
           message = util.toSyncMessage(message);

           expect(message).to.exist;
           expect(message.type).to.equal(SyncMessage.REQUEST);
           expect(message.name).to.equal(SyncMessage.CHKSUM);
           expect(message.content).to.be.an('object');

           var socketPackage2 = util.openSocket(socketData, {
             onClose: function(code, reason) {
               expect(code).to.equal(1008);
               util.cleanupSockets(result.done, socketPackage, socketPackage2);
             }
           });
         }
       });
     });
   });

   it(', after receiving a valid token and syncId, should send a RESPONSE named "AUTHZ"', function(done) {
     util.authenticatedConnection({ done: done }, function( err, result ) {
       expect(err).not.to.exist;
       var socketData = {
         token: result.token
       };

       var socketPackage = util.openSocket({
         onMessage: function(message) {
           expect(message).to.equal(SyncMessage.response.authz.stringify());
           util.cleanupSockets(result.done, socketPackage);
         },
         onOpen: function() {
           socketPackage.socket.send(JSON.stringify(socketData));
         }
       });
     });
   });

   it('should allow two socket connections for the same username from different clients', function(done) {
     util.authenticatedConnection(function( err, result ) {
       expect(err).not.to.exist;
       var socketData = {
         token: result.token
       };

       var socketPackage = util.openSocket(socketData, {
         onMessage: function(message) {
           message = util.toSyncMessage(message);
           expect(message).to.exist;
           expect(message.type).to.equal(SyncMessage.REQUEST);
           expect(message.name).to.equal(SyncMessage.CHKSUM);
           expect(message.content).to.be.an('object');

           util.authenticatedConnection(function(err, result2) {
             expect(err).not.to.exist;
             socketData = {
               syncId: result2.syncId,
               token: result2.token
             };

             var socketPackage2 = util.openSocket(socketData, {
               onMessage: function(message) {
                 util.cleanupSockets(function() {
                   result.done();
                   result2.done();
                   done();
                 }, socketPackage, socketPackage2);
               },
             });
           });
         }
       });
     });
   });

   it('should send an "implementation" SyncMessage error object when a non-syncmessage object is sent', function(done) {
     util.authenticatedConnection({ done: done }, function(err, result) {
       expect(err).not.to.exist;

       var socketData = {
         token: result.token
       };

       var socketPackage = util.openSocket(socketData, {
         onMessage: function(message) {
           // First, confirm server acknowledgment
           message = util.toSyncMessage(message);
           expect(message).to.exist;
           expect(message.type).to.equal(SyncMessage.REQUEST);
           expect(message.name).to.equal(SyncMessage.CHKSUM);
           expect(message.content).to.be.an('object');

           // Listen for SyncMessage error
           socketPackage.socket.on("message", function(message) {
             var implMsg = SyncMessage.error.impl;
             implMsg.content = { error: "The Sync message cannot be handled by the server" };

             expect(message).to.equal(implMsg.stringify());
             util.cleanupSockets(result.done, socketPackage);
           });

           var invalidMessage = {
             anything: "else"
           };

           socketPackage.socket.send(JSON.stringify(invalidMessage));
         }
       });
     });
   });
 });

 describe('Generate Diffs', function() {
   it('should return an RESPONSE message with the diffs', function(done) {
     util.authenticatedConnection({ done: done }, function( err, result ) {
       expect(err).not.to.exist;

       util.prepareDownstreamSync(result.username, result.token, function(err, syncData, fs, socketPackage) {
         util.downstreamSyncSteps.generateDiffs(socketPackage, syncData, fs, function(msg, cb) {
           msg = util.toSyncMessage(msg);

           expect(msg.type, "[Message type error: \"" + (msg.content && msg.content.error) +"\"]" ).to.equal(SyncMessage.RESPONSE);
           expect(msg.name).to.equal(SyncMessage.DIFFS);
           expect(msg.content).to.exist;
           expect(msg.content.diffs).to.exist;
           cb();
         }, function(data) {
           util.cleanupSockets(result.done, socketPackage);
         });
       });
     });
   });
   it('should return an ERROR type message named DIFFS when faulty checksums are sent', function(done) {
     util.authenticatedConnection({ done: done }, function( err, result ) {
       expect(err).not.to.exist;

       util.prepareDownstreamSync(result.username, result.token, function(err, syncData, fs, socketPackage) {
         var diffRequest = SyncMessage.request.diffs;
         diffRequest.content = {
           checksums: "jargon"
         };
         util.sendSyncMessage(socketPackage, diffRequest, function(msg) {
           msg = util.toSyncMessage(msg);

           expect(msg.type, "[Message type error: \"" + (msg.content && msg.content.error) +"\"]" ).to.equal(SyncMessage.ERROR);
           expect(msg.name).to.equal(SyncMessage.DIFFS);
           expect(msg.content).to.exist;
           expect(msg.content.diffs).to.not.exist;
           util.cleanupSockets(result.done, socketPackage);
         });
       });
     });
   });
   it('should return an SyncMessage with error content when no checksums are sent', function(done) {
     util.authenticatedConnection({ done: done }, function( err, result ) {
       expect(err).not.to.exist;

       util.prepareDownstreamSync(result.username, result.token, function(err, syncData, fs, socketPackage) {
         var diffRequest = SyncMessage.request.diffs;
         util.sendSyncMessage(socketPackage, diffRequest, function(msg) {
           msg = util.toSyncMessage(msg);

           expect(msg).to.eql(SyncMessage.error.content);
           util.cleanupSockets(result.done, socketPackage);
         });
       });
     });
   });
 });

 describe('Patch the client filesystem', function() {
   it('should make the server respond with a RESPONSE SYNC SyncMessage after ending a downstream sync, and initiating an upstream sync', function(done) {
     util.authenticatedConnection({ done: done }, function( err, result ) {
       expect(err).not.to.exist;

       util.prepareDownstreamSync('generateDiffs', result.username, result.token, function(err, syncData, fs, socketPackage) {
         util.downstreamSyncSteps.patchClientFilesystem(socketPackage, syncData, fs, function(msg, cb) {
           msg = util.toSyncMessage(msg);
           var startSyncMsg = SyncMessage.request.sync;
           util.sendSyncMessage(socketPackage, startSyncMsg, function(message){
             message = util.toSyncMessage(message);

             expect(message).to.exist;
             expect(message.type).to.equal(SyncMessage.RESPONSE);
             expect(message.name).to.equal(SyncMessage.SYNC);

             cb();
           });
         }, function(data) {
           util.cleanupSockets(result.done, socketPackage);
         });
       });
     });
   });

   it('should return an IMPLEMENTATION ERROR SyncMessage when sent out of turn', function(done) {
     util.authenticatedConnection({ done: done }, function( err, result ) {
       expect(err).not.to.exist;

       util.prepareDownstreamSync(result.username, result.token, function(err, data, fs, socketPackage) {
         var startSyncMsg = SyncMessage.request.sync;
         util.sendSyncMessage(socketPackage, startSyncMsg, function(msg){
           var msg = util.toSyncMessage(msg);

           expect(msg).to.exist;
           expect(msg.type).to.equal(SyncMessage.ERROR);
           expect(msg.name).to.equal(SyncMessage.IMPL);
           expect(msg.content).to.exist;
           expect(msg.content.error).to.exist;

           util.cleanupSockets(result.done, socketPackage);
         });
       });
     });
   });
 });
});

describe('[Upstream Syncing with Websockets]', function(){
  describe('The server', function() {
    it('(same client) should unlock a sync after ' + env.get('CLIENT_TIMEOUT_MS') + ' MS of inactivity after a client begins an upstream sync', function(done) {
      // Authorize a user, open a socket, authorize and complete a downstream sync
      util.authenticatedConnection({ done: done }, function( err, result ) {
        expect(err).not.to.exist;

        util.completeDownstreamSync(result.username, result.token, function(err, syncData, fs, socketPackage) {
          // Authorize a user, open a socket, authorize and complete a downstream sync
          util.upstreamSyncSteps.requestSync(socketPackage, syncData, function(message, cb) {
            message = util.toSyncMessage(message);

            expect(message).to.exist;
            expect(message.type, "[Error: \"" + (message && message.name) + "\"]" ).to.equal(SyncMessage.RESPONSE);
            expect(message.name).to.equal(SyncMessage.SYNC);

            setTimeout(function() {
              util.upstreamSyncSteps.requestSync(socketPackage, syncData, function(message2, cb2) {
                message2 = util.toSyncMessage(message2);

                expect(message2).to.exist;
                expect(message2.type, "[Error: \"" + (message2 && message2.name) + "\"]" ).to.equal(SyncMessage.RESPONSE);
                expect(message2.name).to.equal(SyncMessage.SYNC);

                cb2();
              }, function() {
                cb();
              });
            }, env.get('CLIENT_TIMEOUT_MS') + 50);
          }, function() {
            util.cleanupSockets(result.done, socketPackage);
          });
        });
      });
    });

    it('(second client) should unlock a sync after ' + env.get('CLIENT_TIMEOUT_MS') + ' MS of inactivity after a client begins an upstream sync', function(done) {
      // Authorize a user, open a socket, authorize and complete a downstream sync
      util.authenticatedConnection({ done: done }, function( err, result ) {
        expect(err).not.to.exist;

        util.completeDownstreamSync(result.username, result.token, function(err, syncData, fs, socketPackage) {
          // Authorize a second client for the same user, open a socket, authorize and complete a downstream sync
          util.authenticatedConnection({ username: result.username }, function(err2, result2) {
            expect(err2).not.to.exist;

            util.completeDownstreamSync(result2.username, result2.token, function(err, syncData2, fs2, socketPackage2) {
              // Start an upstream sync with the first client of the user
              util.upstreamSyncSteps.requestSync(socketPackage, syncData2, function(message, cb) {
                message = util.toSyncMessage(message);

                expect(message).to.exist;
                expect(message.type, "[Error: \"" + (message && message.name) + "\"]" ).to.equal(SyncMessage.RESPONSE);
                expect(message.name).to.equal(SyncMessage.SYNC);

                // After it's confirmed to be started, wait half the time before the lock should be broken and
                // get the second client of the same user to initiate an upstream sync
                setTimeout(function() {
                  util.upstreamSyncSteps.requestSync(socketPackage2, syncData2, function(message2, cb2) {
                    message2 = util.toSyncMessage(message2);

                    expect(message2).to.exist;
                    expect(message2.type, "[Error: \"" + (message2 && message2.name) + "\"]" ).to.equal(SyncMessage.RESPONSE);
                    expect(message2.name).to.equal(SyncMessage.SYNC);

                    cb2();
                  }, function() {
                    cb();
                  });
                }, env.get('CLIENT_TIMEOUT_MS') + 50);
              }, function() {
                util.cleanupSockets(result.done, socketPackage, socketPackage2);
              });
            });
          });
        });
      });
    });

    it('should block a sync from a new client before ' + env.get('CLIENT_TIMEOUT_MS') + ' MS of inactivity from a freshly syncing client.', function(done){
      // Authorize a user, open a socket, authorize and complete a downstream sync
      util.authenticatedConnection({ done: done }, function( err, result ) {
        expect(err).not.to.exist;

        util.completeDownstreamSync(result.username, result.token, function(err, syncData, fs, socketPackage) {
          // Authorize a second client for the same user, open a socket, authorize and complete a downstream sync
          util.authenticatedConnection({ username: result.username }, function(err2, result2) {
            expect(err2).not.to.exist;

            util.completeDownstreamSync(result2.username, result2.token, function(err, syncData2, fs2, socketPackage2) {
              // Start an upstream sync with the first client of the user
              util.upstreamSyncSteps.requestSync(socketPackage, syncData2, function(message, cb) {
                message = util.toSyncMessage(message);

                expect(message).to.exist;
                expect(message.type, "[Error: \"" + (message && message.name) + "\"]" ).to.equal(SyncMessage.RESPONSE);
                expect(message.name).to.equal(SyncMessage.SYNC);

                // After it's confirmed to be started, wait half the time before the lock should be broken and
                // get the second client of the same user to initiate an upstream sync
                util.upstreamSyncSteps.requestSync(socketPackage2, syncData2, function(message2, cb2) {
                  message2 = util.toSyncMessage(message2);

                  expect(message2).to.exist;
                  expect(message2.type, "[Error: \"" + (message2 && message2.name) + "\"]" ).to.equal(SyncMessage.ERROR);
                  expect(message2.name).to.equal(SyncMessage.LOCKED);

                  cb2();
                }, function() {
                  cb();
                });
              }, function() {
                util.cleanupSockets(result.done, socketPackage, socketPackage2);
              });
            });
          });
        });
      });
    });
  });
  describe('Request checksums', function() {
    it('should return a CONTENT error SyncMessage if srcList isn\'t passed', function(done) {
      // Authorize a user, open a socket, authorize and complete a downstream sync
      util.authenticatedConnection({ done: done }, function( err, result ) {
        expect(err).not.to.exist;

        util.prepareUpstreamSync('requestSync', result.username, result.token, function(syncData, fs, socketPackage) {
          var requestChksumMsg = SyncMessage.request.chksum;
          requestChksumMsg.content = {
            path: syncData.path
          };
          socketPackage.socket.send(requestChksumMsg.stringify());

          util.sendSyncMessage(socketPackage, requestChksumMsg, function(msg) {
            msg = util.toSyncMessage(msg);

            expect(msg).to.deep.equal(SyncMessage.error.content);

            util.cleanupSockets(result.done, socketPackage);
          });
        });
      });
    });
    it('should return a CONTENT error SyncMessage if path isn\'t passed', function(done) {
      // Authorize a user, open a socket, authorize and complete a downstream sync
      util.authenticatedConnection({ done: done }, function( err, result ) {
        expect(err).not.to.exist;

        util.prepareUpstreamSync('requestSync', result.username, result.token, function(syncData, fs, socketPackage) {
          var requestChksumMsg = SyncMessage.request.chksum;
          requestChksumMsg.content = {
            srcList: syncData.srcList
          };
          socketPackage.socket.send(requestChksumMsg.stringify());

          util.sendSyncMessage(socketPackage, requestChksumMsg, function(msg) {
            msg = util.toSyncMessage(msg);

            expect(msg).to.deep.equal(SyncMessage.error.content);

            util.cleanupSockets(result.done, socketPackage);
          });
        });
      });
    });
    it('should return a CONTENT error SyncMessage if no data is passed', function(done) {
      // Authorize a user, open a socket, authorize and complete a downstream sync
      util.authenticatedConnection({ done: done }, function( err, result ) {
        expect(err).not.to.exist;

        util.prepareUpstreamSync('requestSync', result.username, result.token, function(syncData, fs, socketPackage) {
          var requestChksumMsg = SyncMessage.request.chksum;
          requestChksumMsg.content = {};
          socketPackage.socket.send(requestChksumMsg.stringify());

          util.sendSyncMessage(socketPackage, requestChksumMsg, function(msg) {
            msg = util.toSyncMessage(msg);

            expect(msg).to.deep.equal(SyncMessage.error.content);

            util.cleanupSockets(result.done, socketPackage);
          });
        });
      });
    });
  });
});
