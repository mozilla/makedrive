/*jshint expr: true*/

var expect = require('chai').expect;
var util = require('../lib/util.js');
var request = require('request');
var ws = require('ws');
var SyncMessage = require('../../lib/syncmessage');
var Filer = require('../../lib/filer.js');
var FileSystem = Filer.FileSystem;

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

  describe('[Filesystem Helpers]', function() {
    var provider;

    beforeEach(function() {
      provider = new FileSystem.providers.Memory(util.username());
    });
    afterEach(function() {
      provider = null;
    });

    it('should createFilesystemLayout and ensureFilesystem afterward', function(done) {
      var fs = new FileSystem({provider: provider});
      var layout = {
        "/file1": "contents file1",
        "/dir1/file1": new Buffer([1,2,3]),
        "/dir1/file2": "contents file2",
        "/dir2": null
      };

      util.createFilesystemLayout(fs, layout, function(err) {
        expect(err).not.to.exist;

        util.ensureFilesystem(fs, layout, done);
      });
    });
  });

  describe('[Socket Helpers]', function(){
    it('util.openSocket should open a socket connection with default handlers if none are provided', function(done){
      util.authenticatedConnection({ done: done }, function(err, result) {
        var socketPackage = util.openSocket();
        expect(socketPackage.socket).to.exist;
        expect(socketPackage.socket.readyState).to.exist;
        expect(socketPackage.socket.url).to.exist;
        expect(socketPackage.socket._events).to.exist;
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
        function onClose() {}
        function onError() {}
        function onOpen() {}
        function onMessage() {}

        var socketPackage = util.openSocket({
          onClose: onClose,
          onError: onError,
          onOpen: onOpen,
          onMessage: onMessage
        });

        expect(socketPackage.socket).to.exist;
        expect(socketPackage.socket.readyState).to.exist;
        expect(socketPackage.socket.url).to.exist;
        expect(socketPackage.socket._events).to.exist;
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
        };

        var socketPackage = util.openSocket(socketData, {
          onMessage: function(message){
            // First, confirm server acknowledgment
            message = util.toSyncMessage(message);
            expect(message).to.exist;
            expect(message.type).to.equal(SyncMessage.REQUEST);
            expect(message.name).to.equal(SyncMessage.CHKSUM);
            expect(message.content).to.be.an('object');

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

  describe('[Downstream Sync Helpers]', function() {
    it('util.prepareDownstreamSync should prepare a filesystem for the passed user when finalStep isn\'t specified', function(done) {
      util.authenticatedConnection({done: done}, function(err, result) {
        var username = util.username();

        util.prepareDownstreamSync(username, result.token, function(err, syncData, fs, socketPackage) {
          expect(err).to.not.exist;
          expect(fs).to.exist;
          expect(fs.name).to.exist;
          expect(fs.watch).to.exist;
          expect(fs.provider).to.exist;
          util.cleanupSockets(result.done, socketPackage);
        });
      });
    });

    it('util.downstreamSyncSteps.generateDiffs should return the diffs to the client', function(done) {
      util.authenticatedConnection({ done: done }, function(err, result) {
        var username = util.username();

        util.prepareDownstreamSync(username, result.token, function(err, syncData, fs, socketPackage) {
          util.downstreamSyncSteps.generateDiffs(socketPackage, syncData, fs, function(message, cb) {
            message = util.toSyncMessage(message);

            expect(message.type).to.equal(SyncMessage.RESPONSE);
            expect(message.name).to.equal(SyncMessage.DIFFS);
            expect(message.content).to.exist;
            expect(message.content.diffs).to.exist;
            expect(message.content.path).to.exist;

            cb();
          }, function(msg) {
            util.cleanupSockets(result.done, socketPackage);
          });
        });
      });
    });

    it('util.prepareDownstreamSync should complete the generateDiffs step automatically when passed \'generateDiffs\' as the finalStep', function(done) {
      util.authenticatedConnection({ done: done }, function(err, result) {
        var username = util.username();
        util.prepareDownstreamSync("generateDiffs", username, result.token, function(err, syncData, fs, socketPackage) {
          expect(syncData.diffs).to.exist;

          util.cleanupSockets(result.done, socketPackage);
        });
      });
    });

    it('util.syncSteps.patchClientFilesystem should execute properly, allowing a client to begin an upstream sync', function(done) {
      util.authenticatedConnection({ done: done }, function(err, result) {
        var username = util.username();

        util.prepareDownstreamSync("generateDiffs", username, result.token, function(err, syncData, fs, socketPackage) {
          util.downstreamSyncSteps.patchClientFilesystem(socketPackage, syncData, fs, function(err, data) {
            expect(data).to.exist;
            expect(data.path).to.exist;

            util.upstreamSyncSteps.requestSync(socketPackage, data, function() {
              util.cleanupSockets(result.done, socketPackage);
            });
          });
        });
      });
    });

    it('util.prepareDownstreamSync should complete the patchClientFilesystem step automatically when passed \'patchClientFilesystem\' as the finalStep, allowing a client to begin an upstream sync', function(done) {
      util.authenticatedConnection({ done: done }, function(err, result) {
        var username = util.username();

        util.prepareDownstreamSync("patchClientFilesystem", username, result.token, function(err, syncData, fs, socketPackage) {
          expect(syncData).to.exist;
          expect(syncData.path).to.exist;

          util.upstreamSyncSteps.requestSync(socketPackage, syncData, function() {
            util.cleanupSockets(result.done, socketPackage);
          });
        });
      });
    });
  });

  describe('[Upstream Sync Helpers]', function() {
    it('util.prepareUpstreamSync.prepareSync should return confirmation of a sync to the client', function(done) {
      util.authenticatedConnection({done: done}, function(err, result) {
        var username = util.username();

        util.prepareUpstreamSync(username, result.token, function(err, syncData, fs, socketPackage) {
          expect(fs).to.exist;
          expect(fs.name).to.exist;
          expect(fs.watch).to.exist;
          expect(fs.provider).to.exist;
          util.upstreamSyncSteps.requestSync(socketPackage, syncData, function(message, cb) {
            message = util.toSyncMessage(message);

            expect(message).to.exist;
            expect(message.type).to.equal(SyncMessage.RESPONSE);
            expect(message.name, "[SyncMessage Type error. SyncMessage.content was: " + message.content + "]").to.equal(SyncMessage.SYNC);

            cb();
          }, function() {
            util.cleanupSockets(result.done, socketPackage);
          });
        });
      });
    });

    it('util.prepareUpstreamSync should complete a downstream sync, allowing the client to initiate an upstream sync, and prepare a filesystem for the client when finalStep isn\'t specified', function(done) {
      util.authenticatedConnection({done: done}, function(err, result) {
        var username = util.username();

        util.prepareUpstreamSync(username, result.token, function(err, syncData, fs, socketPackage) {
          expect(err).to.not.exist;
          expect(fs).to.exist;
          expect(fs.name).to.exist;
          expect(fs.watch).to.exist;
          expect(fs.provider).to.exist;
          expect(syncData).to.exist;
          expect(syncData.path).to.exist;

          util.upstreamSyncSteps.requestSync(socketPackage, syncData, function() {
            util.cleanupSockets(result.done, socketPackage);
          });
        });
      });
    });
  });
});
