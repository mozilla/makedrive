SyncMessage.REQUEST = "REQUEST";
SyncMessage.RESPONSE = "RESPONSE";
SyncMessage.STREAM = "STREAM";
SyncMessage.ACK = "ACK";
SyncMessage.SOURCE_LIST = "SOURCE_LIST";
SyncMessage.CHECKSUM = "CHECKSUM";
SyncMessage.DIFF = "DIFF";
SyncMessage.PATCH = "PATCH";
SyncMessage.RESET = "RESET";
SyncMessage.ERROR = "ERROR";

function validateParams(param, paramType) {
  if(param) {
    if(paramType === 'TYPE') {
      return param === SyncMessage.REQUEST ||
        param === SyncMessage.RESPONSE ||
        param === SyncMessage.STREAM;
    } else if(paramType === 'NAME') {
      return param === SyncMessage.SOURCE_LIST ||
        param === SyncMessage.CHECKSUM ||
        param === SyncMessage.DIFF ||
        param === SyncMessage.PATCH ||
        param === SyncMessage.ERROR ||
        param === SyncMessage.ACK ||
        param === SyncMessage.RESET;
    }
  }
  return false;
}

function SyncMessage(type, name) {
  this.type = validateParams(type, 'TYPE') ? type : null;
  //this.name = validateParams(name, 'NAME') ? name : null;
  this.name = name;
  this.content = 'No content';
}

SyncMessage.prototype.setContent = function(content) {
  this.content = content;
};

// TODO: Expose a .toJSON method

module.exports = SyncMessage;
