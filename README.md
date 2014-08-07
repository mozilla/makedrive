MakeDrive
=========

A cloud-based Dropbox&reg; equivalent for browser filesystems. Designed for use with Mozilla Webmaker tools and services.

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
1) Clone the [MakeDrive](https://github.com/mozilla/makedrive) repository.

```
$ git clone https://github.com/mozilla/makedrive.git
```

2) In your MakeDrive directory, install all of the necessary MakeDrive dependencies:

If you don't already have `grunt-cli` installed globally, here is the console command using `npm` -

```
$ sudo npm install grunt-cli -g
```

Afterwards, install the npm modules -

```
$ npm install
```

Next, install submodules' dependencies -
```
$ grunt init
```

3) Copy the distributed environment file via command line, or manually using a code editor:

```
$ cp env.dist .env
```

4) Run the MakeDrive server:

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
`provider` | `<Object>` | a Filer data provider to use instead of the default provider normally used. The provider given should already be instantiated (i.e., don't pass a constructor function).
`forceCreate` | `<Boolean>` | by default we return the same fs instance with every call to `MakeDrive.fs()`. In some cases it is necessary to have multiple instances.  Using forceCreate=true does this.
`interval` | `<Number>` | by default, the filesystem syncs every minute if auto syncing is turned on, otherwise the interval between syncs can be specified in ms.

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
 `'disconnected'` | the connection to the sync server was lost, either due to the client or server.
 `'syncing'` | a sync with the server has begun. A subsequent `'completed'` or `'error'` event should follow at some point, indicating whether or not the sync was successful.
 `'completed'` | a sync has completed and was successful.

### Sync
 The `sync` property also exposes a number of methods, including:

Method | Purpose
------ | -------------------------------------------
 `connect(url, [token])` | Try to connect to the specified sync server URL. An 'error' or 'connected' event will follow, depending on success. If the token parameter is provided, that authentication token will be used. Otherwise the client will try to obtain one from the server's /api/sync route. This requires the user to be authenticated previously with Webmaker.
 `disconnect()` | Disconnect from the sync server.
 `request()` | Request a sync with the server. The path is automatically tracked by any changes that occur within the filesystem. Such requests may or may not be processed.


 Finally, the `sync` property also exposes a "state", which is the
 current sync state and can be one of:

```javascript
 sync.SYNC_DISCONNECTED = 0 /* also the initial state */
 sync.SYNC_CONNECTING = 1
 sync.SYNC_CONNECTED = 2
 sync.SYNC_SYNCING = 3
 sync.SYNC_ERROR = 4
```

## Testing and Contributing
Any assistance in adding new features or enhancing current ones, as well as resolving issues
is greatly appreciated. Please refer to our [CONTRIBUTING.md](./CONTRIBUTING.md) document for more information about internal MakeDrive implementations, git conventions and
testing methodologies for aspiring developers.
