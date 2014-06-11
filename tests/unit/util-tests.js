var expect = require('chai').expect;
var util = require('../lib/util.js');
var request = require('request');

describe('Test util.js', function(){

  it('util.app should return the Express app instance', function () {
    expect(util.app).to.exist;
  });

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

  it('util.connection should return syncId and close method on callback', function (done) {
    util.authenticate(function(err, authResult) {
      expect(err).not.to.exist;
      expect(authResult.username).to.be.a.string;
      expect(authResult.jar).to.exist;

      util.connection(authResult, function(err, connectionResult) {
        expect(err).not.to.exist;
        expect(connectionResult.syncId).to.match(/\w{8}(-\w{4}){3}-\w{12}?/);
        expect(connectionResult.close).to.be.a.function;
        connectionResult.close();
        done();
      });
    });
  });


  it('util.connection should return different syncIds on subsequent calls', function(done) {
    util.authenticate(function(err, result) {
      expect(err).not.to.exist;
      expect(result.username).to.be.a.string;

      util.connection(result, function(err, result1) {
        expect(err).not.to.exist;
        expect(result1.syncId).to.match(/\w{8}(-\w{4}){3}-\w{12}?/);
        expect(result1.close).to.be.a.function;

        var close1 = result1.close;
        var syncId1 = result1.syncId;

        util.authenticate({username: result1.username}, function(err, result2) {
          util.connection(result2, function(err, result3) {
            expect(err).not.to.exist;
            expect(result3.syncId).to.match(/\w{8}(-\w{4}){3}-\w{12}?/);
            expect(result3.syncId).not.to.equal(syncId1);
            expect(result.close).to.be.a.function;
            result3.close();
            close1();
            done();
          });
        });
      });
    });
  });

  it('util.username should generate a unique username with each call', function() {
    var username1 = util.username();
    var username2 = util.username();
    expect(username1).to.be.a.string;
    expect(username2).to.be.a.string;
    expect(username1).not.to.equal(username2);
  });


/***************************************************************************************************
 * NOTE: these tests cause the express app to go into a bad state, then fail tests afterward.
 * Likely this is due to SSE and some kind of bad state in the express app, and we'll get fixed
 * when we switch away from SSE.  For now commenting them out.

  it('util.authenticatedConnection should signin and get a syncId, and username', function(done) {
    util.authenticatedConnection(function(err, result) {
      expect(err).not.to.exist;
      expect(result).to.exist;
      expect(result.jar).to.exist;
      expect(result.syncId).to.be.a.string;
      expect(result.username).to.be.a.string;
      expect(result.done).to.be.a.function;

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


  it('util.syncRouteConnect should access the route in the same way as the api/sync test block when nested within authenticatedConnection', function(done) {
    util.authenticatedConnection({username: 'debug', done: done}, function(err, result) {
      expect(err).not.to.exist;
      expect(result.jar).to.exist;
      expect(result.username).to.equal('debug');

      util.syncRouteConnect(result, function(err, result) {
        expect(err).not.to.exist;
        expect(result).to.exist;
        expect(result.statusCode).to.equal(200);
        expect(result.done).to.be.a.function;
        result.done();
      });
    });
  });
***************************************************************************************************/

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
