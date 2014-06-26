function processDiff(diff, processDataFn) {
  if(diff.contents) {
    diff.contents.forEach(processDiff);
  } else {
    if(Buffer.isBuffer(diff.data)) {
      diff.data = processDataFn(diff.data)
    }
  }
}

module.exports.serialize = function(diffs) {
  if(!diffs.length) {
    return diffs;
  }
  return diffs.map(function(diff){
    processDiff(diff, function bufferToJSON(data) { return data.toJSON(); });
  });
};

module.exports.deserialize = function(diffs) {
  if(!diffs.length) {
    return diffs;
  }
  return diffs.map(function(diff){
    processDiff(diff, function jsonToBuffer(data) { new Buffer(data); });
  });

};
