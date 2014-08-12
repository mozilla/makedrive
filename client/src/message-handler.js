var SyncMessage = require('../../lib/syncmessage');
var rsync = require('../../lib/rsync');
var rsyncOptions = require('../../lib/constants').rsyncDefaults;
var serializeDiff = require('../../lib/diff').serialize;
var deserializeDiff = require('../../lib/diff').deserialize;
var states = require('./sync-states');
var steps = require('./sync-steps');

function onError(syncManager, err) {
  syncManager.session.step = steps.FAILED;
  syncManager.sync.onError(err);
}

function handleRequest(syncManager, data) {
  var fs = syncManager.fs;
  var sync = syncManager.sync;
  var session = syncManager.session;
  var socket = syncManager.socket;

  function handleChecksumRequest() {
    var srcList = data.content.srcList;
    session.path = data.content.path;
    sync.onSyncing();

    rsync.checksums(fs, session.path, srcList, rsyncOptions, function(err, checksums) {
      if (err) {
        return onError(syncManager, err);
      }

      session.step = steps.PATCH;

      var message = SyncMessage.request.diffs;
      message.content = {checksums: checksums};
      socket.send(message.stringify());
    });
  }

  function handleDiffRequest() {
    rsync.diff(fs, session.path, data.content.checksums, rsyncOptions, function(err, diffs) {
      if(err){
        return onError(syncManager, err);
      }

      session.step = steps.PATCH;

      var message = SyncMessage.response.diffs;
      message.content = {diffs: serializeDiff(diffs)};
      socket.send(message.stringify());
    });
  }


  if(data.is.chksum && session.is.ready &&
     (session.is.synced || session.is.failed)) {
    // DOWNSTREAM - CHKSUM
    handleChecksumRequest();
  } else if(data.is.diffs && session.is.syncing && session.is.diffs) {
    // UPSTREAM - DIFFS
    handleDiffRequest();
  } else {
    onError(syncManager, new Error(data.content));
  }
}

function handleResponse(syncManager, data) {
  var fs = syncManager.fs;
  var sync = syncManager.sync;
  var session = syncManager.session;
  var socket = syncManager.socket;

  function handleSrcListResponse() {
    session.state = states.SYNCING;
    session.step = steps.INIT;
    session.path = data.content.path;
    sync.onSyncing();

    rsync.sourceList(fs, session.path, rsyncOptions, function(err, srcList) {
      if(err){
        return onError(syncManager, err);
      }

      session.step = steps.DIFFS;

      var message = SyncMessage.request.chksum;
      message.content = {srcList: srcList};
      socket.send(message.stringify());
    });
  }

  function handlePatchAckResponse() {
    session.state = states.READY;
    session.step = steps.SYNCED;
    sync.onCompleted(data.content.syncedPaths);
  }

  function handlePatchResponse() {
    var diffs = data.content.diffs;
    diffs = deserializeDiff(diffs);

    rsync.patch(fs, session.path, diffs, rsyncOptions, function(err, paths) {
      if (err) {
        return onError(syncManager, err);
      }

      var size = rsyncOptions.size || 5;

      rsync.pathChecksums(fs, paths.synced, size, function(err, checksums) {
        if(err) {
          return onError(syncManager, err);
        }

        var message = SyncMessage.response.patch;
        message.content = {checksums: checksums, size: size};
        socket.send(message.stringify());
      });
    });
  }

  function handleVerificationResponse() {
    session.step = steps.SYNCED;
    sync.onCompleted();
  }

  if(data.is.sync) {
    // UPSTREAM - INIT
    handleSrcListResponse();
  } else if(data.is.patch && session.is.syncing && session.is.patch) {
    // UPSTREAM - PATCH
    handlePatchAckResponse();
  } else if(data.is.diffs && session.is.ready && session.is.patch) {
    // DOWNSTREAM - PATCH
    handlePatchResponse();
  } else if(data.is.verification && session.is.ready && session.is.patch) {
    // DOWNSTREAM - PATCH VERIFICATION
    handleVerificationResponse();
  } else {
    onError(syncManager, new Error(data.content));
  }
}

function handleError(syncManager, data) {
  var sync = syncManager.sync;
  var session = syncManager.session;
  var socket = syncManager.socket;

  // DOWNSTREAM - ERROR
  if((((data.is.srclist && session.is.synced) || 
        (data.is.verification && session.is.synced)) &&
       session.is.ready) ||
      (data.is.diffs && session.is.patch && (session.is.ready || session.is.syncing))) {
    session.state = states.READY;
    session.step = steps.SYNCED;

    var message = SyncMessage.request.reset;
    socket.send(message.stringify());
    onError(syncManager, new Error('Could not sync filesystem from server... trying again'));
  } else if(data.is.locked && session.is.ready && session.is.synced) {
    // UPSTREAM - LOCK
    onError(syncManager, new Error('Current sync in progress! Try again later!'));
  } else if(((data.is.chksum && session.is.diffs) ||
             (data.is.patch && session.is.patch)) &&
            session.is.syncing) {
    // UPSTREAM - ERROR
    onError(syncManager, new Error('Fatal error: Failed to sync to server'));
  } else {
    onError(syncManager, new Error(data.content));
  }
}

function handleMessage(syncManager, data) {
  try {
    data = JSON.parse(data);
    data = SyncMessage.parse(data);
  } catch(e) {
    return onError(syncManager, e);
  }

  if (data.is.request) {
    handleRequest(syncManager, data);
  } else if(data.is.response){
    handleResponse(syncManager, data);
  } else if(data.is.error){
    handleError(syncManager, data);
  } else {
    onError(syncManager, new Error('Cannot handle message'));
  }
}

module.exports = handleMessage;
