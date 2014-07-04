SyncMessage.REQUEST = "REQUEST";
SyncMessage.RESPONSE = "RESPONSE";
SyncMessage.ERROR = "ERROR";
SyncMessage.SRCLIST = "SRCLIST";
SyncMessage.SYNC = "SYNC";
SyncMessage.CHKSUM = "CHKSUM";
SyncMessage.DIFFS = "DIFFS";
SyncMessage.PATCH = "PATCH";
SyncMessage.RESET = "RESET";
SyncMessage.LOCKED = "LOCKED";
SyncMessage.AUTHZ = "AUTHORIZED";

function validateParams(param, paramType) {
  if(param) {
    if(paramType === 'TYPE') {
      return param === SyncMessage.REQUEST ||
        param === SyncMessage.RESPONSE ||
        param === SyncMessage.ERROR;
    } else if(paramType === 'NAME') {
      return param === SyncMessage.SRCLIST ||
        param === SyncMessage.CHKSUM ||
        param === SyncMessage.DIFFS ||
        param === SyncMessage.LOCKED ||
        param === SyncMessage.PATCH ||
        param === SyncMessage.SYNC ||
        param === SyncMessage.RESET ||
        param === SyncMessage.AUTHZ;
    }
  }
  return false;
}

function SyncMessage(type, name) {
  this.type = validateParams(type, 'TYPE') ? type : null;
  this.name = validateParams(name, 'NAME') ? name : null;
  this.content = 'No content';
}

SyncMessage.prototype.setContent = function(content) {
  this.content = content;
};

// TODO: Expose .stringify() method in SyncMessage library
//       https://github.com/mozilla/makedrive/issues/19
module.exports = SyncMessage;
