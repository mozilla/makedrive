if ( process.env.NEW_RELIC_ENABLED ) {
  require( "newrelic" );
}

var express = require( "express" ),
    helmet = require( "helmet" ),
    WebmakerAuth = require( "webmaker-auth" ),
    EventEmitter = require('events').EventEmitter,
    uuid = require('node-uuid');
    var S3Provider = require("filer-s3");
    var FSProvider = require("filer-fs");
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
    emitter = new EventEmitter(),
    connectedClients = {},
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

// Generates callback functions for emitting messages to clients
var eventSourceHelper = {
  sendOutOfDateMsg: function( connectionId, res ){
    // Send an out of date message to all clients except
    // the one that just sync'd new changes
    return function(username, id) {
      console.log("here in sendOutOfDateMsg")
      console.log(connectionId, id);
      if (connectionId != id) {
        res.write("data: " + 'You are out of date! Sync from source to update current session.' + '\n\n');
      }
    };
  }
};

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

app.get( "/", routes.index );
app.get( "/p/*", middleware.authenticationHandler, routes.get );
app.get( "/gone", middleware.authenticationHandler, routes.clear );

// GET /api/sync/:connectionId
app.get('/api/sync/:connectionId', function (req, res) {
  var username = req.session && req.session.user.username;

  if (!username) {
    res.send(400, {
      error: 'No user identified'
    });
  } else if (syncTable.hasOwnProperty(username)) {
    res.send(423, {
      error: 'A sync with this user is already in progress'
    });
  } else {
    var id = req.param('connectionId');
    var fs = new Filer.FileSystem( { provider: new FSProvider( { keyPrefix: "dave" } ) } );
    function finish() {
      syncTable[username] = {
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
  console.log(req.params)
  var syncId = req.param('syncId');
console.log(syncId)
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

  var fs = getFileSystem(syncId);
  if(!fs) {
    res.send(500, 'Expected filesystem for sync session');
    return;
  }

  rsync.patch(fs, req.session.path, diffs, options, function (err, data) {
    if (err) {
      endSync(syncId);
      res.send(500, err);
    } else {
      console.log("aadkaskdksdksakd")
      res.send(200);
      endSync(syncId);
      emitter.emit( 'updateToLatestSync', req.session.user.username, syncId );
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

app.get( "/healthcheck", routes.healthcheck );

app.get( "/update-stream", function( req, res ) {
  console.log("264")
  var username = req.session.username,
      connectionId = uuid.v4(),
      onOutOfDate = eventSourceHelper.sendOutOfDateMsg( connectionId, res );

  // let request last as long as possible
  req.socket.setTimeout(Infinity);

  // We're assuming one user, but this is where we'd add a new user to
  // the object that keeps track of them
  if (!connectedClients[username]) {
    connectedClients[username] = {};
  }
  connectedClients[username][connectionId] = {
    onOutOfDate: onOutOfDate
  };

  // Have this client listen for "out of date" messages
  emitter.on( 'updateToLatestSync', onOutOfDate );

  //send headers for event-stream connection
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  res.write('\n');

  var data = {
    connectionId: connectionId
  };
  console.log("line number: 295", data);
  console.log("295")
  res.write("data: " + JSON.stringify(data) + "\n\n");
console.log("297")
  // Stream has closed
  req.on("close", function() {
    delete connectedClients[username][connectionId];
    emitter.removeListener( 'updateToLatestSync', onOutOfDate );
  });
});

port = env.get( "PORT", 9090 );
app.listen( port, function() {
  console.log( "MakeDrive server listening ( Probably http://localhost:%d )", port );
});





