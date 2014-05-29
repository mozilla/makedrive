if ( process.env.NEW_RELIC_ENABLED ) {
  require( "newrelic" );
}

var express = require( "express" ),
    helmet = require( "helmet" ),
    WebmakerAuth = require( "webmaker-auth" );

var app = express(),
    env = require( "./environment" ),
    Path = require( "path" ),
    distDir = Path.resolve( __dirname, "dist" ),
    webmakerAuth = new WebmakerAuth({
      loginURL: env.get( "LOGIN_SERVER_URL_WITH_AUTH" ),
      secretKey: env.get( "SESSION_SECRET" ),
      forceSSL: env.get( "FORCE_SSL" ),
      domain: env.get( "COOKIE_DOMAIN" )
    }),
    routes = require( "./routes" ),
    middleware = require( "./middleware" ),
    messina,
    logger,
    port,
    Filer = require('filer'),
    rsync = require('./rsync'),
    sourceList,
    syncTable = {},
    options = {
      size: 5,
      links: false,
      recursive: true
    };

// Generate a random sync session ID
function generateSyncId() {
  var str,
    generate = true;

  while (generate) {
    str = '';
    for (var i = 0; i < 20; i++) {
      str += (Math.floor(Math.random() * 100) + 1) % 2 ?
        String.fromCharCode(Math.floor(Math.random() * 26) + 65) :
        Math.floor(Math.random() * 10);
    }
    if (getUserBySyncId(str) == null) {
      generate = false;
    }
  }
  return str;
}

// Get the username by the sync session ID
function getUserBySyncId(syncId) {
  for (var u in syncTable) {
    if (syncTable[u].syncId == syncId) {
      return u;
    }
  }
  return null;
}

// Terminate a sync session by invalidating a sync session ID
function endSync(syncId) {
  var user = getUserBySyncId(syncId);
  if (user)
    delete syncTable[user];
}

// Get filesystem by syncId
function getFileSystem(syncId) {
  var user = getUserBySyncId(syncId);
  if(!user) {
    return null;
  }
  return syncTable[user].fs;
}

// Check if a request is part of a sync session
function isSyncSession(req) {
  if (!req.param('syncId') || !getUserBySyncId(req.param('syncId'))) {
    return false;
  } else {
    return true;
  }
}

if ( env.get( "ENABLE_GELF_LOGS" ) ) {
  messina = require( "messina" );
  logger = messina( "MakeDrive-" + env.get( "NODE_ENV" ) || "development" );
  logger.init();
  app.use( logger.middleware() );
} else {
  app.use( express.logger( "dev" ) );
}

app.use(express.static(Path.join(__dirname,'../client')));
app.disable( "x-powered-by" );
app.use( helmet.contentTypeOptions() );
app.use( helmet.hsts() );
app.enable( "trust proxy" );
app.use( express.compress() );
app.use( express.json() );
app.use( express.urlencoded() );
app.use( webmakerAuth.cookieParser() );
app.use( webmakerAuth.cookieSession() );

app.use( app.router );

app.use( middleware.errorHandler );
app.use( middleware.fourOhFourHandler );

function corsOptions ( req, res ) {
  res.header( "Access-Control-Allow-Origin", "*" );
}

// GET /api/sync?user=abc
app.get('/api/sync', function (req, res) {
  if (!req.query.hasOwnProperty('user')) {
    res.send(400, {
      error: 'No user identified'
    });
  } else if (syncTable.hasOwnProperty(req.query.user)) {
    res.send(423, {
      error: 'A sync with this user is already in progress'
    });
  } else {
    var id = generateSyncId();
    var fs = new Filer.FileSystem({provider: new Filer.FileSystem.providers.Memory()});
    function finish() {
      syncTable[req.query.user] = {
        syncId: id,
        fs: fs
      };
      res.json(200, {
        syncId: id
      });
    }
    fs.mkdir('/data', function(err, data) {
      finish();
    });
  }
});

// POST /api/sync/X3D125AD49CS910AW3E2/sources
app.post('/api/sync/:syncId/sources', function (req, res) {
  if (!isSyncSession(req)) {
    res.send(403, 'Sync not initiated');
    return;
  }
  
  req.session.path = req.body.path;
  req.session.sourceList = req.body.srcList;
  
  res.send(201);
});

// GET /api/sync/X3D125AD49CS910AW3E2/checksums
app.get('/api/sync/:syncId/checksums', function (req, res) {
  if (!isSyncSession(req)) {
    res.send(403, 'Sync not initiated');
    return;
  }
  
  var fs = getFileSystem(req.param('syncId'));
  if(!fs) {
    res.send(500, 'Expected filesystem for sync session');
    return;
  }
  rsync.checksums(fs, req.session.path, req.session.sourceList, options, function (err, checksums) {
    if (err) {
      endSync(req.param('syncId'));
      res.send(500, err);
    } else {
      res.json({
        checksums: checksums
      });
    }
  });
});

// PUT /api/sync/X3D125AD49CS910AW3E2/diffs
app.put('/api/sync/:syncId/diffs', function (req, res) {
  if (!isSyncSession(req)) {
    res.send(403, 'Sync not initiated');
    return;
  }

  var diffs = req.body.diffs;
  
  // Parse JSON diffs to Uint8Array
  for (var i = 0; i < diffs.length; i++) {
    for (var j = 0; j < diffs[i].contents.length; j++) {
      for (var k = 0; k < diffs[i].contents[j].diff.length; k++) {
        if (diffs[i].contents[j].diff[k].data) {
          diffs[i].contents[j].diff[k].data = diffs[i].contents[j].diff[k].data;
          // Deal with special-cased flattened typed arrays in WebSQL (see put() below)
          if (diffs[i].contents[j].diff[k].data.__isUint8Array) {
            diffs[i].contents[j].diff[k].data = new Uint8Array(diffs[i].contents[j].diff[k].data.__array);
          }
        }
      }
    }
  }

  var fs = getFileSystem(req.param('syncId'));
  if(!fs) {
    res.send(500, 'Expected filesystem for sync session');
    return;
  }
  
  rsync.patch(fs, req.session.path, diffs, options, function (err, data) {
    if (err) {
      endSync(req.param('syncId'));
      res.send(500, err);
    } else {
      endSync(req.param('syncId'));
      res.send(200);
    }
  });
});

// Serve makedrive client-side js files
app.get( "/js/makedrive.js", function( req, res ) {
  res.sendfile( Path.join( distDir, "makedrive.js" ) );
});
app.get( "/js/makedrive.min.js", function( req, res ) {
  res.sendfile( Path.join( distDir, "makedrive.min.js" ) );
});

port = env.get( "PORT", 9090 );
app.listen( port, function() {
  console.log( "MakeDrive server listening ( Probably http://localhost:%d )", port );
});
