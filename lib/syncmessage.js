// SyncMessage Type constants
SyncMessage.REQUEST = "REQUEST";
SyncMessage.RESPONSE = "RESPONSE";
SyncMessage.ERROR = "ERROR";

// SyncMessage Name constants
SyncMessage.SRCLIST = "SRCLIST";
SyncMessage.SYNC = "SYNC";
SyncMessage.CHKSUM = "CHKSUM";
SyncMessage.DIFFS = "DIFFS";
SyncMessage.PATCH = "PATCH";
SyncMessage.RESET = "RESET";
SyncMessage.LOCKED = "LOCKED";
SyncMessage.AUTHZ = "AUTHORIZED";
SyncMessage.IMPL = "IMPLEMENTATION";

// SyncMessage Error constants
SyncMessage.INFRMT = "INVALID FORMAT";
SyncMessage.INCONT = "INVALID CONTENT";

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
        param === SyncMessage.AUTHZ ||
        param === SyncMessage.IMPL ||
        param === SyncMessage.INFRMT ||
        param === SyncMessage.INCONT;
    }
  }
  return false;
}

function createError(code, message) {
  var error = new SyncMessage(SyncMessage.ERROR, code);
  error.setContent({error: message});
  return error;
}

// Constructor
function SyncMessage(type, name) {
  this.type = validateParams(type, 'TYPE') ? type : null;
  this.name = validateParams(name, 'NAME') ? name : null;
  this.content = 'No content';
}

// Set the body of a SyncMessage
SyncMessage.prototype.setContent = function(content) {
  this.content = content;
};

// SyncMessage errors
SyncMessage.errors = {
  INFRMT: createError(SyncMessage.INFRMT, 'Message must be formatted as a sync message'),
  INCONT: createError(SyncMessage.INCONT, 'Invalid content provided')
}

SyncMessage.generateError = function(message) {
  return createError(SyncMessage.IMPL, message);
};

// TODO: Expose .stringify() method in SyncMessage library
//       https://github.com/mozilla/makedrive/issues/19
module.exports = SyncMessage;
