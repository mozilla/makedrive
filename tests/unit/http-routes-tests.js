var expect = require('chai').expect;
var request = require('request');
var util = require('../lib/util');
var server = require('../lib/server-utils.js');
var Filer = require('../../lib/filer.js');
var FileSystem = Filer.FileSystem;
var Path = Filer.Path;
var env = require('../../server/lib/environment');
env.set('ALLOWED_CORS_DOMAINS', server.serverURL);
var ALLOW_DOMAINS = process.env.ALLOWED_CORS_DOMAINS;
var unzip = require("../lib/unzip.js");

describe('[HTTP route tests]', function() {
  before(function(done) {
    server.start(done);
  });
  after(function(done) {
    server.shutdown(done);
  });

  it('should allow CORS access to /api/sync route', function(done) {
    server.run(function() {
      request.get(server.serverURL + '/api/sync', { headers: {origin: ALLOW_DOMAINS }}, function(req, res) {
        expect(ALLOW_DOMAINS).to.contain(res.headers['access-control-allow-origin']);
        done();
      });
    });
  });

  describe('/p/ route tests', function() {
    it('should return a 404 error page if the path is not recognized', function(done) {
      server.authenticate(function(err, result) {
        expect(err).not.to.exist;
        expect(result.jar).to.exist;

        request.get({
          url: server.serverURL + '/p/no/file/here.html',
          jar: result.jar
        }, function(err, res, body) {
          expect(err).not.to.exist;
          expect(res.statusCode).to.equal(404);
          expect(body).to.match(/<title>404 Not Found<\/title>/);
          expect(body).to.match(/The requested URL \/no\/file\/here.html was not found on this server./);
          done();
        });
      });
    });

    it('should return the contents of a file if the path is valid', function(done) {
      var username = util.username();
      var content = "This is the content of the file.";

      server.upload(username, '/index.html', content, function(err) {
        if(err) throw err;

        server.authenticate({username: username}, function(err, result) {
          if(err) throw err;

          // /p/index.html should come back as uploaded
          request.get({
            url: server.serverURL + '/p/index.html',
            jar: result.jar
          }, function(err, res, body) {
            expect(err).not.to.exist;
            expect(res.statusCode).to.equal(200);
            expect(body).to.equal(content);

            // /p/ should come back with dir listing
            request.get({
              url: server.serverURL + '/p/',
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


  describe('/j/ route tests', function() {
    it('should return a 404 error page if the path is not recognized', function(done) {
      server.authenticate(function(err, result) {
        expect(err).not.to.exist;
        expect(result.jar).to.exist;

        request.get({
          url: server.serverURL + '/j/no/file/here.html',
          jar: result.jar,
          json: true
        }, function(err, res, body) {
          expect(err).not.to.exist;
          expect(res.statusCode).to.equal(404);
          expect(body.error.code).to.equal(404);
          expect(body.error.message).to.match(/The requested URL \/no\/file\/here.html was not found on this server./);
          done();
        });
      });
    });

    it('should return the contents of a file if the path is valid', function(done) {
      var username = util.username();
      var content = "This is the content of the file.";

      server.upload(username, '/index.html', content, function(err) {
        if(err) throw err;

        server.authenticate({username: username}, function(err, result) {
          if(err) throw err;

          // /j/index.html should come back as JSON
          request.get({
            url: server.serverURL + '/j/index.html',
            jar: result.jar,
            json: true
          }, function(err, res, body) {
            expect(err).not.to.exist;
            expect(res.statusCode).to.equal(200);
            expect(body).to.equal(content);

            // /j/ should come back with dir listing
            request.get({
              url: server.serverURL + '/j/',
              jar: result.jar,
              json: true
            }, function(err, res, body) {
              expect(err).not.to.exist;
              expect(res.statusCode).to.equal(200);

              /**
               * We expect JSON something like this:
               * [{path: 'index.html',
               *   links: 1,
               *   size: 32,
               *   modified: 1407336648736,
               *   type: 'FILE'}]
               */
              expect(body.length).to.equal(1);
              expect(body[0].path).to.equal('index.html');
              expect(body[0].links).to.equal(1);
              expect(body[0].size).to.be.a.number;
              expect(body[0].modified).to.be.a.number;
              expect(body[0].type).to.equal('FILE');

              done();
            });
          });
        });
      });
    });
  });

  describe('/z/ route tests', function() {
    it('should return a 404 error page if the path is not recognized', function(done) {
      server.authenticate(function(err, result) {
        expect(err).not.to.exist;
        expect(result.jar).to.exist;

        request.get({
          url: server.serverURL + '/z/no/file/here.html',
          jar: result.jar
        }, function(err, res, body) {
          expect(err).not.to.exist;
          expect(res.statusCode).to.equal(404);
          expect(body).to.match(/<title>404 Not Found<\/title>/);
          expect(body).to.match(/The requested URL \/no\/file\/here.html was not found on this server./);
          done();
        });
      });
    });

    it('should return export.zip for a valid path', function(done) {
      var username = util.username();
      var content = "This is the content of the file.";

      server.upload(username, '/index.html', content, function(err) {
        if(err) throw err;

        server.authenticate({username: username}, function(err, result) {
          if(err) throw err;

          // /z/ should come back as export.zip with one dir and file
          // in the archive.
          request.get({
            url: server.serverURL + '/z/',
            jar: result.jar,
            encoding: null
          }, function(err, res, body) {
            expect(err).not.to.exist;
            expect(res.statusCode).to.equal(200);
            expect(res.headers['content-type']).to.equal('application/zip');
            expect(res.headers['content-disposition']).to.equal('attachment; filename=export.zip');

            // Write the zip file to filer, unzip, and compare file to original
            var fs = new FileSystem({provider: new FileSystem.providers.Memory(username)});
            var sh = new fs.Shell();

            sh.tempDir(function(err, tmp) {
              if(err) throw err;

              fs.writeFile('/exports.zip', body, function(err) {
                if(err) throw err;

                unzip(fs, '/exports.zip', { destination: tmp }, function(err) {
                  if(err) throw err;

                  fs.readFile(Path.join(tmp, 'export/index.html'), 'utf8', function(err, data) {
                    if(err) throw err;
                    expect(data).to.equal(content);
                    done();
                  });
                });
              });
            });
          });
        });
      });
    });
  });


  describe('/s/:username/* route tests', function() {
    it('should return a 404 error page if the path is not recognized', function(done) {
      var username = util.username();
      var content = "This is the content of the file.";

      server.upload(username, '/index.html', content, function(err) {
        if(err) throw err;

        request.get({
          url: server.serverURL + '/s/' + username + '/no/file/here.html',
          auth: {
            user: 'testusername',
            pass: 'testpassword'
          },
          json: true
        }, function(err, res) {
          expect(err).not.to.exist;
          expect(res.statusCode).to.equal(404);
          done();
        });
      });
    });

    it('should return a 401 error if invalid username:password is used for basic auth', function(done) {
      var username = util.username();
      var content = "This is the content of the file.";

      server.upload(username, '/index.html', content, function(err) {
        if(err) throw err;

        request.get({
          url: server.serverURL + '/s/' + username + '/no/file/here.html',
          auth: {
            user: 'wrong-testusername',
            pass: 'wrong-testpassword'
          },
          json: true
        }, function(err, res) {
          expect(err).not.to.exist;
          expect(res.statusCode).to.equal(401);
          done();
        });
      });
    });

    it('should return the file requested if it exists and correct auth is provided', function(done) {
      var username = util.username();
      var content = "This is the content of the file.";

      server.upload(username, '/index.html', content, function(err) {
        if(err) throw err;

        request.get({
          url: server.serverURL + '/s/' + username + '/index.html',
          auth: {
            user: 'testusername',
            pass: 'testpassword'
          }
        }, function(err, res, body) {
          expect(err).not.to.exist;
          expect(res.statusCode).to.equal(200);
          expect(body).to.equal(content);
          done();
        });
      });
    });

    it('should return a Buffer for a binary file requested if it exists and correct auth is provided', function(done) {
      var username = util.username();
      var content = new Buffer([1, 2, 3, 4]);

      server.upload(username, '/binary', content, function(err) {
        if(err) throw err;

        request.get({
          url: server.serverURL + '/s/' + username + '/binary',
          auth: {
            user: 'testusername',
            pass: 'testpassword'
          },
          encoding: null
        }, function(err, res, body) {
          expect(err).not.to.exist;
          expect(res.statusCode).to.equal(200);
          expect(body).to.deep.equal(content);
          done();
        });
      });
    });

    it('should return a JSON dir listing if a dir path is requested and correct auth is provided', function(done) {
      var username = util.username();
      var content = "This is the content of the file.";

      server.upload(username, '/index.html', content, function(err) {
        if(err) throw err;

        request.get({
          url: server.serverURL + '/s/' + username + '/',
          auth: {
            user: 'testusername',
            pass: 'testpassword'
          },
          json: true
        }, function(err, res, body) {
          expect(err).not.to.exist;
          expect(res.statusCode).to.equal(200);
          /**
           * We expect JSON something like this:
           * [{path: 'index.html',
           *   links: 1,
           *   size: 32,
           *   modified: 1407336648736,
           *   type: 'FILE'}]
           */
          expect(body.length).to.equal(1);
          expect(body[0].path).to.equal('index.html');
          expect(body[0].links).to.equal(1);
          expect(body[0].size).to.be.a.number;
          expect(body[0].modified).to.be.a.number;
          expect(body[0].type).to.equal('FILE');
          done();
        });
      });
    });
  });
});
