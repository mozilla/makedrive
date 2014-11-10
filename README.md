MakeDrive
=========

An offline-first, always available, syncing filesystem for the web. MakeDrive gives web pages and apps a
complete filesystem that can be used offline, and also synced with the cloud.

MakeDrive is designed for use with Mozilla Webmaker tools and services, but could be adapted to any use.

See the [Mozilla MakeDrive Wiki](https://wiki.mozilla.org/Webmaker/MakeDrive) page for background info.

## Compatibility

### Desktop Browsers
&nbsp;&nbsp;![-](http://i.imgur.com/DZShiTO.png) Google Chrome: 31+ (IndexedDB, WebSQL)

&nbsp;&nbsp;![-](http://i.imgur.com/ktnnqwk.png) Mozilla Firefox: 26+ (IndexedDB)

&nbsp;&nbsp;![-](http://i.imgur.com/hVZWdYc.png) Opera: 19+ (IndexedDB, WebSQL)

&nbsp;&nbsp;![-](http://i.imgur.com/m4zi8bV.png) Safari: 7.0+ (WebSQL)

&nbsp;&nbsp;![-](http://i.imgur.com/rCDK1qb.png) Internet Explorer: 10+ (IndexedDB)

### Engines/Platforms
- Node.js: v0.10+

## Installation and Use
1) Install and run [redis](http://redis.io/), which MakeDrive uses for distributed locks.

2) Clone the [MakeDrive](https://github.com/mozilla/makedrive) repository.

```
$ git clone https://github.com/mozilla/makedrive.git
```

3) In your MakeDrive directory, install all of the necessary MakeDrive dependencies:

If you don't already have `grunt-cli` and `bower` installed globally, here is the console command using `npm` -

```
$ sudo npm install bower -g
```

```
$ sudo npm install grunt-cli -g
```

The server's log level can be set in the environment or the .env file using `LOG_LEVEL=*`
with one of `fatal`, `error`, `warn`, `info`, `debug`, `trace`. If none is given `info` is used.

Afterwards, install the npm modules -

```
$ npm install
```

Next, install dependencies -
```
$ bower install
```

4) Copy the distributed environment file via command line, or manually using a code editor:

```
$ cp env.dist .env
```

5) Run the MakeDrive server at the default log level:

```
$ npm start
```

You will now have MakeDrive running on localhost via port 9090 - [http://localhost:9090](http://localhost:9090)

### Developer Demo

An independent and lightweight front-end instance has been added to test MakeDrive's functionality on its own.
The [NODE_ENV](https://github.com/mozilla/makedrive/blob/master/env.dist#L5) variable must be set to `development` in your `.env` file for this page to be enabled.
It currently resides on and can be visited at [localhost:9090/demo/?makedrive=ws://localhost:9090](localhost:9090/demo/?makedrive=ws://localhost:9090).

**NOTE:** For connecting the demo with another MakeDrive server, the localhost address and port of the above demo page must be added to the [ALLOWED_CORS_DOMAINS](https://github.com/mozilla/makedrive/blob/master/env.dist#L12) variable in the `.env` file of
the instance you are trying to connect to in order to avoid cross-origin resource errors.

## Overview
Built on top of the [Filer](https://github.com/js-platform/filer) filesystem interface, MakeDrive adds cloud-like syncing functionality that allows for multiple clients to share and interact with an active project directory from different browsers
or platforms. There are features and options for both ***manual*** and ***auto*** syncing.

Below is a simple way to create and initiate a MakeDrive instance on client-side code:

`var fs = MakeDrive.fs();`


Multiple calls to `MakeDrive.fs()` will return the same instance.

### Routes

MakeDrive has three HTTP REST endpoints for retrieving user filesystem data in various formats. All of these routes require authentication and are not meant for public use, but for users and apps to allow easy access to data when logged in.
Each one is accessed by simply being appended to the URL that presently hosts MakeDrive <br>(eg. `https://makedrive.mofostaging.net/p/`):

&nbsp;&nbsp;`/p/` - Serves as a path for a user's Filer filesystem. You can currently view anything that has been synced inside of the user's project directory tree. <br>
&nbsp;&nbsp;`/j/` - Similar to the `/p/` route, but serves the path information in `JSON` format for APIs.<br>
&nbsp;&nbsp;`/z/` - Used to export the current user's project data in compressed ZIP format.

There is also an optional `/s/:username/:path` route for server-to-server requests. This route
requires HTTP Basic AUTH, and is disabled by default. It is designed for servers vs. users to be able
to get file and folder data for a user. It is not meant for user access. It can be enabled by adding a
`username:password` pair to the `.env` file for the `BASIC_AUTH_USERS` variable.

## Authentication
MakeDrive uses [Passport.js](http://passportjs.org/) for authentication middleware. Currently MakeDrive supports 4 providers:

provider  | description
--------  | --------------
`passport-github`   | Passport strategy for authenticating with GitHub using the OAuth 2.0 API.
`passport-env`     | Passport strategy for authenticating using environment configuration.
`passport-zeroconfig` (default)    | Passport strategy for always authenticated root user.
`passport-query-string`    | Passport strategy for authenticating with a username and password provided on the query string.
`passport-webmaker` | Passport strategy for authenticating with [Webmaker](https://github.com/mozilla/login.webmaker.org) session.

To use one of the above provider you can set the environment configuration `AUTHENTICATION_PROVIDER`.

Example using `passport-github`:

Set the environment configurations in your `.env` file.

```
export AUTHENTICATION_PROVIDER="passport-github"
export GITHUB_CLIENTID="clientId"
export GITHUB_CLIENTSECRET="clientSecret"
export GITHUB_CALLBACKURL="http://callbackurl"
```

You can also check other providers listed in the [providers directory](./server/authentication/providers) for more information.

## API Reference

###Constructor
```javascript
var fs = MakeDrive.fs({
  manual: true,
  memory: true,
  forceCreate: true
  // etc.
});
```
A number of configuration options can be passed to the `fs()` function.
These include:


Option | Value | Definition
------ | ----- |----------------------------------
`manual` | `true` | by default the filesystem syncs automatically in the background. This disables it.
`memory` | `<Boolean>` | by default we use a persistent store (indexeddb or websql). Using memory=true overrides and uses a temporary ram disk.
`autoReconnect` | `<Boolean>` | 'true' by default. When toggled to 'true', MakeDrive will automatically try to reconnect to the server if the WebSocket closed for any reason (e.g. no network connection or server crash).
`reconnectAttempts` | `<Number>` | By default, MakeDrive will try to reconnect forever. This sets a maximum number for attempts, after which a reconnect_failed event will be emitted.
`reconnectionDelay` | `<Number>` | Default to 1000 (ms). How long to wait before attempting a new reconnection.
`reconnectionDelayMax` | `<Number>` | Default to 5000 (ms). Maximum amount of time to wait between reconnections. Each attempt increases the reconnection by the amount specified by reconnectionDelay.
`provider` | `<Object>` | a Filer data provider to use instead of the default provider normally used. The provider given should already be instantiated (i.e., don't pass a constructor function).
`forceCreate` | `<Boolean>` | by default we return the same fs instance with every call to `MakeDrive.fs()`. In some cases it is necessary to have multiple instances.  Using forceCreate=true does this.
`interval` | `<Number>` | by default, the filesystem syncs every 15 seconds if auto syncing is turned on, otherwise the interval between syncs can be specified in ms.
`windowCloseWarning` | `<Boolean>` | `false` by default. When toggled to `true`, prompts the user to confirm exiting the webpage when trying to close in the middle of a sync.

Various bits of Filer are available on MakeDrive, including:

 `MakeDrive.Buffer` <br>
 `MakeDrive.Path` <br>
 `MakeDrive.Errors`

See [Filer's](https://github.com/js-platform/filer/blob/develop/README.md) docs for more information.

___

## MakeDrive Instance Methods

### Events
The filesystem instance returned by `MakeDrive.fs()` includes
the property `sync`.  The `fs.sync` property is an EventEmitter
 which emits the following events:

Event | Description
----- | -------------------------------------------
 `'error'`| an error occurred while connecting/syncing. The error object is passed as the first arg to the event.
 `'connected'` | a connection was established with the sync server
 `'reconnect_failed'` | fired when the maximum reconnect attempts is reached and a connection could not be made.
 `'reconnecting'` | fired every time a reconnect attempt is made.
 `'disconnected'` | the connection to the sync server was lost, either due to the client or server.
 `'syncing'` | a sync with the server has begun. A subsequent `'completed'` or `'error'` event should follow at some point, indicating whether or not the sync was successful.
 `'completed'` | a sync has completed and was successful.

### Sync
 The `sync` property also exposes a number of methods, including:

Method | Purpose
------ | -------------------------------------------
 `connect(url, [token])` | Try to connect to the specified sync server URL. An 'error' or 'connected' event will follow, depending on success. If the token parameter is provided, that authentication token will be used. Otherwise the client will try to obtain one from the server's /api/sync route. This requires the user to be authenticated.
 `disconnect()` | Disconnect from the sync server.
 `request()` | Request a sync with the server. The path is automatically tracked by any changes that occur within the filesystem. Such requests may or may not be processed.


 Finally, the `sync` property also exposes a "state", which is the
 current sync state and can be one of:

```javascript
 sync.SYNC_DISCONNECTED = "SYNC DISCONNECTED" /* also the initial state */
 sync.SYNC_CONNECTING = "SYNC CONNECTING"
 sync.SYNC_CONNECTED = "SYNC CONNECTED"
 sync.SYNC_SYNCING = "SYNC SYNCING"
 sync.SYNC_ERROR = "SYNC ERROR"
```

### Logging

MakeDrive provides various levels of logging. By default it is disabled, but it can be enabled
using `MakeDrive.log.level()`:

```js
// Use debug logging
MakeDrive.log.level('debug');

// Use info logging
MakeDrive.log.level('info');

// Disable logging after it was turned on
MakeDrive.log.level('disabled');
```

In addition to using level name strings, you can use `MakeDrive.log.INFO`, `MakeDrive.log.DEBUG`,
`MakeDrive.log.WARN`, `MakeDrive.log.ERROR`, etc.

## Testing and Contributing
Any assistance in adding new features or enhancing current ones, as well as resolving issues
is greatly appreciated. Please refer to our [CONTRIBUTING.md](./CONTRIBUTING.md) document for more information about internal MakeDrive implementations, git conventions and
testing methodologies for aspiring developers.
