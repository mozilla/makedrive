var SyncMessage = require('../../lib/syncmessage');
var rsync = require('../../lib/rsync');
var rsyncOptions = require('../../lib/constants').rsyncDefaults;
var serializeDiff = require('../../lib/diff').serialize;
var deserializeDiff = require('../../lib/diff').deserialize;
var states = require('./sync-states');
var steps = require('./sync-steps');

function emitError(syncSession, syncObject, err) {
  syncSession.step = steps.FAILED;
  syncObject.state = syncObject.SYNC_ERROR;
  return syncObject.emit('error', err);
}

function callbackError(syncSession, err, callback) {
  syncSession.state = states.ERROR;
  return callback(err);
}

function handleRequest(data, fs, syncObject, syncSession, socket, callback) {

  function handleChecksumRequest() {
    syncObject.state = syncObject.SYNC_SYNCING;
    var srcList = data.content.srcList;
    syncSession.path = data.content.path;

    rsync.checksums(fs, syncSession.path, srcList, rsyncOptions, function(err, checksums) {
      if (err) {
        emitError(syncSession, syncObject, err);
      } else {
        syncObject.emit('syncing');
        syncSession.step = steps.PATCH;

        var message = SyncMessage.request.diffs;
        message.content = {checksums: checksums};

        socket.send(message.stringify());
      }
    });
  }

  function handleDiffRequest() {
    rsync.diff(fs, syncSession.path, data.content.checksums, rsyncOptions, function(err, diffs) {
      if(err){
        callbackError(syncSession, err, callback);
      } else {
        syncSession.step = steps.PATCH;

        var message = SyncMessage.response.diffs;
        message.content = {diffs: serializeDiff(diffs)};
        socket.send(message.stringify());
      }
    });
  }

  if (data.is.chksum && syncSession.is.ready &&
      (syncSession.is.synced || syncSession.is.failed)) {
    // DOWNSTREAM - CHKSUM
    handleChecksumRequest();
  } else if(data.is.diffs && syncSession.is.syncing && syncSession.is.diffs) {
    // UPSTREAM - DIFFS
    handleDiffRequest();
  } else {
    syncObject.state = syncObject.SYNC_ERROR;
    syncObject.emit('error', data.content);
  }
}

function handleResponse(data, fs, syncObject, syncSession, socket, callback) {

  function handleSrcListResponse() {
    syncSession.state = states.SYNCING;
    syncSession.step = steps.INIT;
    syncObject.state = syncObject.SYNC_SYNCING;
    syncObject.emit('syncing');

    rsync.sourceList(fs, syncSession.path, rsyncOptions, function(err, srcList) {
      if(err){
        callbackError(syncSession, err, callback);
      } else {
        syncSession.step = steps.DIFFS;

        var message = SyncMessage.request.chksum;
        message.content = {srcList: srcList, path: syncSession.path};
        socket.send(message.stringify());
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

        var message = SyncMessage.response.patch;
        socket.send(message.stringify());
        syncObject.emit('completed');
      }
    });
  }

  if(data.is.sync) {
    // UPSTREAM - INIT
    handleSrcListResponse();
  } else if(data.is.patch && syncSession.is.syncing && syncSession.is.patch) {
    // UPSTREAM - PATCH
    handlePatchAckResponse();
  } else if(data.is.diffs && syncSession.is.ready && syncSession.is.patch) {
    // DOWNSTREAM - PATCH
    handlePatchResponse();
  } else {
    syncObject.state = syncObject.SYNC_ERROR;
    return syncObject.emit('error', new Error(data.content));
  }
}

function handleError(data, syncObject, syncSession, callback) {
  // DOWNSTREAM - ERROR
  if(((data.is.srclist && syncSession.is.synced) ||
      (data.is.diffs && syncSession.is.synced)) &&
     syncSession.is.ready) {
    // TODO: handle what to do to reinitiate downstream sync
    emitError(syncSession, syncObject, new Error('Could not sync filesystem from server'));
  } else if(data.is.locked && syncSession.is.ready && syncSession.is.synced) {
    // UPSTREAM - LOCK
    callbackError(syncSession, new Error('Current sync in progress! Try again later!'), callback);
  } else if(((data.is.chksum && syncSession.is.diffs) ||
             (data.is.patch && syncSession.is.patch)) &&
            syncSession.is.syncing) {
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
    data = SyncMessage.parse(data);
  } catch(e) {
    syncObject.state = syncObject.SYNC_ERROR;
    return syncObject.emit('error', e);
  }

  if (data.is.request) {
    handleRequest(data, fs, syncObject, syncSession, socket, callback);
  } else if(data.is.response){
    handleResponse(data, fs, syncObject, syncSession, socket, callback);
  } else if(data.is.error){
    handleError(data, syncObject, syncSession, callback);
  } else {
    syncObject.state = syncObject.SYNC_ERROR;
    syncObject.emit('error', new Error('Cannot handle message'));
  }
}

module.exports = handleMessage;
