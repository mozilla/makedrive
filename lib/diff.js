/**
 * Functions to process lists of Node Diff objects (i.e.,
 * diffs of files, folders). A Node Diff object takes the
 * following form:
 *
 * // Node Diff for file path (note presence of .diffs)
 * {
 *   modified: 1404926919696,
 *   path: 'index.html',
 *   diffs: [
 *     {
 *       length: 56,
 *       index: 17,
 *       data: Buffer([...])
 *     },
 *     ...
 *   ]
 * }
 *
 * // Node Diff for directory path (note presence of .contents)
 * {
 *   modified: 1404926919696,
 *   path: 'index.html',
 *   contents: [
 *     nodeDiffObject,
 *     ...
 *   ]
 * }
 */

 var Buffer = require('./filer.js').Buffer;

function processNodeDiff(nodeDiff, processDataFn) {
  // Check if this is a directory or file, process, and return
  if(nodeDiff.contents) {
    nodeDiff.contents = nodeDiff.contents.map(function(nodeDiff) {
      return processNodeDiff(nodeDiff, processDataFn);
    });
  } else {
    nodeDiff.diffs = nodeDiff.diffs.map(function(diff) {
      diff.data = processDataFn(diff.data);
      return diff;
    });
  }

  return nodeDiff;
}

function bufferToJSON(data) {
  if(!Buffer.isBuffer(data)) {
    return data;
  }
  var json = data.toJSON();
  // Note: when we're in node.js, json will be the raw array.
  // In browserify it will be {type:'Buffer', data:[...]}
  return json.data || json;
}

function jsonToBuffer(data) {
  return new Buffer(data);
}

function processFn(nodeDiffs, processDataFn) {
  if(!nodeDiffs.length) {
    return nodeDiffs;
  }
  return nodeDiffs.map(function(nodeDiff){
    return processNodeDiff(nodeDiff, processDataFn);
  });
}

module.exports.serialize = function(nodeDiffs) {
  return processFn(nodeDiffs, bufferToJSON);
};

module.exports.deserialize = function(nodeDiffs) {
  return processFn(nodeDiffs, jsonToBuffer);
};
