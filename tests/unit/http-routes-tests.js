/*jshint expr: true*/

var expect = require('chai').expect;
var request = require('request');
var util = require('../lib/util');
var Filer = require('../../lib/filer.js');
var FileSystem = Filer.FileSystem;
var Path = Filer.Path;
var env = require('../../server/lib/environment');
env.set('ALLOWED_CORS_DOMAINS', util.serverURL);
var ALLOW_DOMAINS = process.env.ALLOWED_CORS_DOMAINS;

describe('[HTTP route tests]', function() {

  it('should allow CORS access to /api/sync route', function(done) {
    request.get(util.serverURL + '/api/sync', { headers: {origin: ALLOW_DOMAINS }}, function(req, res, body) {
      expect(ALLOW_DOMAINS).to.contain(res.headers['access-control-allow-origin']);
      done();
    });
  });

  describe('/p/ route tests', function() {
    it('should return a 404 error page if the path is not recognized', function(done) {
      util.authenticate(function(err, result) {
        expect(err).not.to.exist;
        expect(result.jar).to.exist;

        request.get({
          url: util.serverURL + '/p/no/file/here.html',
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

      util.upload(username, '/index.html', content, function(err) {
        if(err) throw err;

        util.authenticate({username: username}, function(err, result) {
          if(err) throw err;

          // /p/index.html should come back as uploaded
          request.get({
            url: util.serverURL + '/p/index.html',
            jar: result.jar
          }, function(err, res, body) {
            expect(err).not.to.exist;
            expect(res.statusCode).to.equal(200);
            expect(body).to.equal(content);

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


  describe('/j/ route tests', function() {
    it('should return a 404 error page if the path is not recognized', function(done) {
      util.authenticate(function(err, result) {
        expect(err).not.to.exist;
        expect(result.jar).to.exist;

        request.get({
          url: util.serverURL + '/j/no/file/here.html',
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

      util.upload(username, '/index.html', content, function(err) {
        if(err) throw err;

        util.authenticate({username: username}, function(err, result) {
          if(err) throw err;

          // /j/index.html should come back as JSON
          request.get({
            url: util.serverURL + '/j/index.html',
            jar: result.jar,
            json: true
          }, function(err, res, body) {
            expect(err).not.to.exist;
            expect(res.statusCode).to.equal(200);
            expect(body).to.equal(content);

            // /j/ should come back with dir listing
            request.get({
              url: util.serverURL + '/j/',
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
      util.authenticate(function(err, result) {
        expect(err).not.to.exist;
        expect(result.jar).to.exist;

        request.get({
          url: util.serverURL + '/z/no/file/here.html',
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

      util.upload(username, '/index.html', content, function(err) {
        if(err) throw err;

        util.authenticate({username: username}, function(err, result) {
          if(err) throw err;

          // /z/ should come back as export.zip with one dir and file
          // in the archive.
          request.get({
            url: util.serverURL + '/z/',
            jar: result.jar,
            encoding: null
          }, function(err, res, body) {
            expect(err).not.to.exist;
            expect(res.statusCode).to.equal(200);
            expect(res.headers['content-type']).to.equal('application/zip');
            expect(res.headers['content-disposition']).to.equal('attachment; filename=export.zip');

            // Write the zip file to filer, unzip, and compare file to original
            var fs = new FileSystem({provider: new FileSystem.providers.Memory(username)});
            var sh = fs.Shell();

            sh.tempDir(function(err, tmp) {
              if(err) throw err;

              fs.writeFile('/exports.zip', body, function(err) {
                if(err) throw err;

                sh.unzip('/exports.zip', { destination: tmp }, function(err) {
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
});
