var expect = require('chai').expect;
var util = require('../lib/util.js');
var request = require('request');
var ws = require('ws');
var SyncMessage = require('../../server/lib/syncmessage');
var FileSystem = require('filer').FileSystem;

describe('Test util.js', function(){
  describe('[Connection Helpers]', function() {
    it('util.authenticate should signin the given user and set session.user.username', function(done) {
      var username = util.username();
      util.authenticate({username: username}, function(err, result) {
        expect(err).not.to.exist;
        expect(result.username).to.equal(username);
        expect(result.jar).to.exist;

        // Trying to login a second time as this user will 401 if session info is set
        request.post({
          url: util.serverURL + '/mocklogin/' + username,
          jar: result.jar
        }, function(err, res, body) {
          expect(err).not.to.exist;
          expect(res.statusCode).to.equal(401);
          done();
        });
      });
    });
    it('util.authenticate should work with no options object passed', function(done) {
      util.authenticate(function(err, result) {
        expect(err).not.to.exist;
        expect(result.username).to.be.a.string;
        expect(result.jar).to.exist;
        done();
      });
});
    it('util.getWebsocketToken should return a token on callback', function(done) {
      var username = util.username();
      util.authenticate({username: username}, function(err, authResult) {
        util.getWebsocketToken(authResult, function(err, tokenResult) {
          expect(tokenResult.token).to.be.a('string');
          done();
        });
      });
    });
    it('util.authenticatedConnection should signin and get a username, and ws token', function(done) {
      util.authenticatedConnection(function(err, result) {
        expect(err, "[err]").not.to.exist;
        expect(result, "[result]").to.exist;
        expect(result.jar, "[result.jar]").to.exist;
        expect(result.username, "[result.username]").to.be.a("string");
        expect(result.token, "[result.token]").to.be.a("string");
        expect(result.done, "[result.done]").to.be.a("function");

        request.get({
          url: util.serverURL + '/',
          jar: result.jar
        }, function(err, res, body) {
          expect(err).not.to.exist;
          expect(res.statusCode).to.equal(200);
          result.done();
          done();
        });
      });
    });
    it('util.authenticatedConnection should accept done function', function(done) {
      util.authenticatedConnection({done: done}, function(err, result) {
        expect(err).not.to.exist;
        expect(result).to.exist;
        expect(result.jar).to.exist;
        expect(result.syncId).to.be.a.string;
        expect(result.username).to.be.a.string;
        expect(result.done).to.be.a.function;

        result.done();
      });
    });
  });

  describe('[Misc Helpers]', function(){
    it('util.app should return the Express app instance', function () {
      expect(util.app).to.exist;
    });
    it('util.username should generate a unique username with each call', function() {
      var username1 = util.username();
      var username2 = util.username();
      expect(username1).to.be.a.string;
      expect(username2).to.be.a.string;
      expect(username1).not.to.equal(username2);
    });
    it('util.upload should allow a file to be uploaded and served', function(done) {
      var fs = require('fs');
      var Path = require('path');
      var content = fs.readFileSync(Path.resolve(__dirname, '../test-files/index.html'), {encoding: null});
      var username = util.username();

      util.upload(username, '/index.html', content, function(err) {
        expect(err).not.to.exist;

        util.authenticate({username: username}, function(err, result) {
          expect(err).not.to.exist;
          expect(result.jar).to.exist;

          // /p/index.html should come back as uploaded
          request.get({
            url: util.serverURL + '/p/index.html',
            jar: result.jar
          }, function(err, res, body) {
            expect(err).not.to.exist;
            expect(res.statusCode).to.equal(200);
            expect(body).to.equal(content.toString('utf8'));

            // /p/ should come back with dir listing
            request.get({
              url: util.serverURL + '/p/',
              jar: result.jar
            }, function(err, res, body) {
              expect(err).not.to.exist;
              expect(res.statusCode).to.equal(200);
              // Look for artifacts we'd expect in the directory listing
              expect(body).to.match(/<head><title>Index of \/<\/title>/);
              expect(body).to.match(/<a href="\/p\/index.html">index.html<\/a>/);
              done();
            });
          });
        });
      });
    });
  });

  describe('[Doesn\'t Belong Here!]', function(){
    it('/p/ should give a 404 if the path is unknown', function(done) {
      util.authenticate(function(err, result) {
        expect(err).not.to.exist;
        expect(result.jar).to.exist;

        request.get({
          url: util.serverURL + '/p/no/file/here.html',
          jar: result.jar
        }, function(err, res, body) {
          expect(err).not.to.exist;
          expect(res.statusCode).to.equal(200);
          expect(body).to.match(/<title>404 Not Found<\/title>/);
          expect(body).to.match(/The requested URL \/no\/file\/here.html was not found on this server./);
          done();
        });
      });
    });
  });

  describe('[Socket Helpers]', function(){
    it('util.openSocket should open a socket connection with default handlers if none are provided', function(done){
      util.authenticatedConnection({ done: done }, function(err, result) {
        var socketPackage = util.openSocket();

        expect(socketPackage.socket instanceof ws).to.be.true;
        expect(typeof socketPackage.onOpen).to.deep.equal("function");
        expect(typeof socketPackage.onClose).to.deep.equal("function");
        expect(typeof socketPackage.onError).to.deep.equal("function");
        expect(typeof socketPackage.onMessage).to.deep.equal("function");

        socketPackage.setClose(function() {
          result.done();
        });
        socketPackage.socket.close();
      });
    });
    it('util.openSocket should open a socket with custom handlers when passed', function(done){
      util.authenticatedConnection({ done: done }, function(err, result) {
        function onClose() {};
        function onError() {};
        function onOpen() {};
        function onMessage() {};

        var socketPackage = util.openSocket({
          onClose: onClose,
          onError: onError,
          onOpen: onOpen,
          onMessage: onMessage
        });

        expect(socketPackage.socket instanceof ws).to.be.true;
        expect(socketPackage.onOpen).to.deep.equal(onOpen);
        expect(socketPackage.onClose).to.deep.equal(onClose);
        expect(socketPackage.onError).to.deep.equal(onError);
        expect(socketPackage.onMessage).to.deep.equal(onMessage);

        socketPackage.setClose(function() {
          result.done();
        });
        socketPackage.socket.close();
      });
    });
    it('util.openSocket should automatically generate an onOpen handler to send syncId to the server when passed syncId', function(done) {
      util.authenticatedConnection({ done: done }, function(err, result) {
        var socketData = {
          token: result.token
        }

        var socketPackage = util.openSocket(socketData, {
          onMessage: function(message){
            expect(message).to.equal(JSON.stringify(new SyncMessage(SyncMessage.RESPONSE, SyncMessage.ACK)));

            socketPackage.setClose(function() {
              result.done();
            });
            socketPackage.socket.close();
          }
        });
      });
    });
    it('util.openSocket\'s returned socketPackage.setXXX functions should change the socket\'s event handlers', function(done) {
      util.authenticatedConnection({ done: done }, function(err, result) {
        var socketPackage = util.openSocket();

        var newClose = function (){};
        var newOpen = function () {};
        var newError = function () {};
        var newMessage = function () {};

        socketPackage.setClose(newClose);
        socketPackage.setError(newError);
        socketPackage.setOpen(newOpen);
        socketPackage.setMessage(newMessage);

        expect(socketPackage.onClose).to.deep.equal(newClose);
        expect(socketPackage.onError).to.deep.equal(newError);
        expect(socketPackage.onOpen).to.deep.equal(newOpen);
        expect(socketPackage.onMessage).to.deep.equal(newMessage);

        socketPackage.setClose(function() {
          result.done();
        });
        socketPackage.socket.close();
      });
    });
    it('util.cleanupSockets should close a single socket and end tests', function(done){
      util.authenticatedConnection({ done: done }, function(err, result) {
        var socketPackage = util.openSocket();
        util.cleanupSockets(function() {
          expect(socketPackage.socket.readyState).to.equal(3);
          result.done();
        }, socketPackage);
      });
    });
    it('util.cleanupSockets should close multiple sockets and end tests', function(done){
      util.authenticatedConnection({ done: done }, function(err, result) {
        var socketPackage1 = util.openSocket();
        var socketPackage2 = util.openSocket();
        var socketPackage3 = util.openSocket();

        util.cleanupSockets(function() {
          expect(socketPackage1.socket.readyState).to.equal(3);
          expect(socketPackage2.socket.readyState).to.equal(3);
          expect(socketPackage3.socket.readyState).to.equal(3);
          result.done();
        }, socketPackage1, socketPackage2, socketPackage3);
      });
    });
  });

  describe('[Sync Helpers]', function(done) {
    it('util.prepareSync should prepare a filesystem for the passed user when finalStep isn\'t specified', function(done) {
      util.authenticatedConnection({done: done}, function(err, result) {
        var socketData = {
          token: result.token
        };

        var username = util.username();
        var socketPackage = util.openSocket(socketData, {
          onMessage: function(message) {
            expect(message).to.equal(JSON.stringify(SyncMessage.Response.ACK));

            util.prepareSync(username, socketPackage, function(syncData, fs) {
              expect(fs instanceof FileSystem).to.equal.true;
              util.cleanupSockets(result.done, socketPackage);
            });
          }
        });
      });
    });
    it('util.syncSteps.srcList should complete the srcList step of the sync, exposing srcList and path to the client', function(done) {
      util.authenticatedConnection({ done: done }, function(err, result) {
        var username = util.username();
        var socketData = {
          token: result.token
        };

        var socketPackage = util.openSocket(socketData, {
          onMessage: function(message) {
            expect(message).to.equal(JSON.stringify(new SyncMessage(SyncMessage.RESPONSE, SyncMessage.ACK)));

            util.prepareSync(username, socketPackage, function(syncData, fs) {
              util.syncSteps.srcList(socketPackage, function(data) {
                expect(data.srcList).to.be.an("array");
                expect(data.path).to.be.a("string");

                util.cleanupSockets(result.done, socketPackage);
              });
            });
          }
        });
      });
    });
    it('util.prepareSync should complete the srcList step automatically when passed \'srcList\' as the finalStep', function(done) {
      util.authenticatedConnection({ done: done }, function(err, result) {
        var username = util.username();
        var socketData = {
          token: result.token
        };

        var socketPackage = util.openSocket(socketData, {
          onMessage: function(message) {
            expect(message).to.equal(JSON.stringify(new SyncMessage(SyncMessage.RESPONSE, SyncMessage.ACK)));

            util.prepareSync("srcList", username, socketPackage, function(syncData, fs) {
              expect(syncData.srcList).to.be.an("array");
              expect(syncData.path).to.be.a("string");

              util.cleanupSockets(result.done, socketPackage);
            });
          }
        });
      });
    });
    it('util.syncSteps.checksums should execute successfully', function(done) {
      util.authenticatedConnection({ done: done }, function(err, result) {
        var username = util.username();
        var socketData = {
          token: result.token
        };

        var socketPackage = util.openSocket(socketData, {
          onMessage: function(message) {
            expect(message).to.equal(JSON.stringify(new SyncMessage(SyncMessage.RESPONSE, SyncMessage.ACK)));

            util.prepareSync("srcList", username, socketPackage, function(syncData, fs) {
              util.syncSteps.checksums(socketPackage, syncData, function(data) {
                util.cleanupSockets(result.done, socketPackage);
              });
            });
          }
        });
      });
    });
    it('util.prepareSync should complete the checksums step automatically when passed \'checksums\' as the finalStep', function(done) {
      util.authenticatedConnection({ done: done }, function(err, result) {
        var username = util.username();
        var socketData = {
          token: result.token
        };

        var socketPackage = util.openSocket(socketData, {
          onMessage: function(message) {
            expect(message).to.equal(JSON.stringify(new SyncMessage(SyncMessage.RESPONSE, SyncMessage.ACK)));

            util.prepareSync("checksums", username, socketPackage, function(syncData, fs) {
              util.cleanupSockets(result.done, socketPackage);
            });
          }
        });
      });
    });
    it('util.syncSteps.diffs should return the checksums to the client', function(done) {
      util.authenticatedConnection({ done: done }, function(err, result) {
        var username = util.username();
        var socketData = {
          token: result.token
        };

        var socketPackage = util.openSocket(socketData, {
          onMessage: function(message) {
            expect(message).to.equal(JSON.stringify(new SyncMessage(SyncMessage.RESPONSE, SyncMessage.ACK)));

            util.prepareSync("checksums", username, socketPackage, function(syncData, fs) {
              util.syncSteps.diffs(socketPackage, syncData, fs, function(data) {
                expect(syncData.diffs).to.exist;

                util.cleanupSockets(result.done, socketPackage);
              });
            });
          }
        });
      });
    });
    it('util.prepareSync should complete the diffs step automatically when passed \'diffs\' as the finalStep', function(done) {
      util.authenticatedConnection({ done: done }, function(err, result) {
        var username = util.username();
        var socketData = {
          token: result.token
        };

        var socketPackage = util.openSocket(socketData, {
          onMessage: function(message) {
            expect(message).to.equal(JSON.stringify(new SyncMessage(SyncMessage.RESPONSE, SyncMessage.ACK)));

            util.prepareSync("diffs", username, socketPackage, function(syncData, fs) {
              expect(syncData.diffs).to.exist;

              util.cleanupSockets(result.done, socketPackage);
            });
          }
        });
      });
    });
    it('util.syncSteps.patch should return an ACK', function(done) {
      util.authenticatedConnection({ done: done }, function(err, result) {
        var username = util.username();
        var socketData = {
          token: result.token
        };

        var socketPackage = util.openSocket(socketData, {
          onMessage: function(message) {
            expect(message).to.equal(JSON.stringify(new SyncMessage(SyncMessage.RESPONSE, SyncMessage.ACK)));

            util.prepareSync("diffs", username, socketPackage, function(syncData, fs) {
              util.syncSteps.patch(socketPackage, syncData, fs, function(err) {
                expect(err).not.to.exist;

                util.cleanupSockets(result.done, socketPackage);
              });
            });
          }
        });
      });
    });
    it('util.prepareSync should complete the patch step automatically when passed \'patch\' as the finalStep', function(done) {
      util.authenticatedConnection({ done: done }, function(err, result) {
        var username = util.username();
        var socketData = {
          token: result.token
        };

        var socketPackage = util.openSocket(socketData, {
          onMessage: function(message) {
            expect(message).to.equal(JSON.stringify(new SyncMessage(SyncMessage.RESPONSE, SyncMessage.ACK)));

            util.prepareSync("patch", username, socketPackage, function(syncData, fs) {
              util.cleanupSockets(result.done, socketPackage);
            });
          }
        });
      });
    });
  });
});
