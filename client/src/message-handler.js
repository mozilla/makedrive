var SyncMessage = require('./syncmessage');
var rsync = require('../../lib/rsync');
var rsyncOptions = require('../../lib/constants').rsyncDefaults;
var serializeDiff = require('../../lib/diff').serialize;
var deserializeDiff = require('../../lib/diff').deserialize;
var states = require('./sync-states');
var steps = require('./sync-steps');

function emitError(syncSession, syncObject, err) {
  syncSession.step = steps.FAILED;
  syncObject.state = _sync.SYNC_ERROR;
  return syncObject.emit('error', err);
}

function callbackError(syncSession, err, callback) {
  syncSession.state = states.ERROR;
  return callback(err);
}

function handleRequest(data, fs, syncObject, syncSession, socket, callback) {

  function handleChecksumRequest() {
    syncObject.state = sync.SYNC_SYNCING;
    var srcList = data.content.srcList;
    syncSession.path = data.content.path;

    rsync.checksums(fs, syncSession.path, srcList, rsyncOptions, function(err, checksums) {
      if (err) {
        emitError(syncSession, syncObject, err);
      } else {
        syncObject.emit('syncing');
        syncSession.step = steps.PATCH;

        var message = new SyncMessage(SyncMessage.REQUEST, SyncMessage.DIFFS);
        message.setContent({checksums: checksums});

        socket.send(JSON.stringify(message));
      }
    });
  }

  function handleDiffRequest() {
    rsync.diff(fs, syncSession.path, data.content.checksums, rsyncOptions, function(err, diffs) {
      if(err){
        callbackError(syncSession, err, callback);
      } else {
        syncSession.step = steps.PATCH;
        var message = new SyncMessage(SyncMessage.RESPONSE, SyncMessage.DIFFS);
        diffs = serializeDiff(diffs);
        message.setContent({diffs: diffs});
        socket.send(JSON.stringify(message));
      }
    });
  }

  if (data.name === SyncMessage.CHKSUM  && syncSession.state === states.READY &&
      (syncSession.step === steps.SYNCED || syncSession.step === steps.FAILED)) {
    // DOWNSTREAM - CHKSUM
    handleChecksumRequest();
  } else if(data.name === SyncMessage.DIFFS && syncSession.state === states.SYNCING && syncSession.step === steps.DIFFS) {
    // UPSTREAM - DIFFS
    handleDiffRequest();
  } else {
    syncObject.state = sync.SYNC_ERROR;
    syncObject.emit('error', new Error(data.content));
  }
}

function handleResponse(data, fs, syncObject, syncSession, socket, callback) {

  function handleSrcListResponse() {
    syncSession.state = states.SYNCING;
    syncSession.step = steps.SYNC_INIT;
    syncObject.state = syncObject.SYNC_SYNCING;
    syncObject.emit('syncing');

    rsync.sourceList(fs, syncSession.path, rsyncOptions, function(err, srcList) {
      if(err){
        callbackError(syncSession, err, callback);
      } else {
        syncSession.step = steps.DIFFS;
        var message = new SyncMessage(SyncMessage.REQUEST, SyncMessage.CHKSUM);
        message.setContent({srcList: srcList, path: syncSession.path});
        socket.send(JSON.stringify(message));
      }
    });
  }

  function handlePatchAckResponse() {
    syncSession.state = states.READY;
    syncSession.step = steps.SYNCED;
    syncObject.state = syncObject.SYNC_CONNECTED;
    callback();
  }

  function handlePatchResponse() {
    var diffs = data.content.diffs;
    syncSession.path = data.content.path;

    diffs = deserializeDiff(diffs);
    rsync.patch(fs, syncSession.path, diffs, rsyncOptions, function(err) {
      if (err) {
        emitError(syncSession, syncObject, err);
      } else {
        syncSession.step = steps.SYNCED;
        syncObject.state = syncObject.SYNC_CONNECTED;
        var message = new SyncMessage(SyncMessage.RESPONSE, SyncMessage.PATCH);
        socket.send(JSON.stringify(message));
        syncObject.emit('completed');
      }
    });
  }

  if(data.name === SyncMessage.SYNC) {
    // UPSTREAM - INIT
    handleSrcListResponse();
  } else if(data.name === SyncMessage.PATCH && syncSession.state === states.SYNCING && syncSession.step === steps.PATCH) {
    // UPSTREAM - PATCH
    handlePatchAckResponse();
  } else if(data.name === SyncMessage.DIFFS && syncSession.state === states.READY && syncSession.step === steps.PATCH) {
    // DOWNSTREAM - PATCH
    handlePatchResponse();
  } else {
    syncObject.state = syncObject.SYNC_ERROR;
    return syncObject.emit('error', new Error(data.content));
  }
}

function handleError(data, syncObject, syncSession, callback) {
  // DOWNSTREAM - ERROR
  if(((data.name === SyncMessage.SRCLIST && syncSession.step === steps.SYNCED) ||
      (data.name === SyncMessage.DIFFS && syncSession.step === steps.SYNCED)) &&
     syncSession.state === states.READY) {
    // TODO: handle what to do to reinitiate downstream sync
    emitError(syncSession, syncObject, new Error('Could not sync filesystem from server'));
  } else if(data.name === SyncMessage.LOCKED && syncSession.state === states.READY && syncSession.step === steps.SYNCED) {
    // UPSTREAM - LOCK
    callbackError(syncSession, new Error('Current sync in progress! Try again later!'), callback);
  } else if(((data.name === SyncMessage.CHKSUM && syncSession.step === steps.DIFFS) ||
             (data.name === SyncMessage.PATCH && syncSession.step === steps.PATCH)) &&
            syncSession.state === states.SYNCING) {
    // UPSTREAM - ERROR
    syncSession.step = steps.FAILED;
    callbackError(syncSession, new Error('Fatal error: Failed to sync to server'), callback);
  } else {
    syncObject.emit('error', data.content.error);
  }
}

function handleMessage(fs, syncObject, syncSession, socket, data, flags, callback) {
  data = data.data;
  try {
    data = JSON.parse(data);
  } catch(e) {
    syncObject.state = syncObject.SYNC_ERROR;
    return syncObject.emit('error', e);
  }

  if (data.type === SyncMessage.REQUEST) {
    handleRequest(data, fs, syncObject, syncSession, socket, callback);
  } else if(data.type === SyncMessage.RESPONSE){
    handleResponse(data, fs, syncObject, syncSession, socket, callback);
  } else if(data.type === SyncMessage.ERROR){
    handleError(data, syncObject, syncSession, callback);
  } else {
    syncObject.state = syncObject.SYNC_ERROR;
    syncObject.emit('error', new Error('Cannot handle message'));
  }
}

module.exports = handleMessage;
