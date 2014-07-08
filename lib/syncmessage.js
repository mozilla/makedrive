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

SyncMessage.prototype.stringify = function() {
  return JSON.stringify(this);
};

// SyncMessage errors
SyncMessage.errors = {
  INFRMT: createError(SyncMessage.INFRMT, 'Message must be formatted as a sync message'),
  INCONT: createError(SyncMessage.INCONT, 'Invalid content provided')
};

SyncMessage.generateError = function(message) {
  return createError(SyncMessage.IMPL, message);
};

// Sugar for getting message instances
SyncMessage.request = Object.create(Object.prototype, {
  diffs: {
    get: function() { return new SyncMessage(SyncMessage.REQUEST, SyncMessage.DIFFS); }
  },
  chksum: {
    get: function() { return new SyncMessage(SyncMessage.REQUEST, SyncMessage.CHKSUM); }
  },
  sync: {
    get: function() { return new SyncMessage(SyncMessage.REQUEST, SyncMessage.SYNC); }
  }
});
SyncMessage.response = Object.create(Object.prototype, {
  diffs: {
    get: function() { return new SyncMessage(SyncMessage.RESPONSE, SyncMessage.DIFFS); }
  },
  patch: {
    get: function() { return new SyncMessage(SyncMessage.RESPONSE, SyncMessage.PATCH); }
  },
  authz: {
    get: function() { return new SyncMessage(SyncMessage.RESPONSE, SyncMessage.AUTHZ); }
  },
  sync: {
    get: function() { return new SyncMessage(SyncMessage.RESPONSE, SyncMessage.SYNC); }
  }
});
SyncMessage.error = Object.create(Object.prototype, {
  srclist: {
    get: function() { return new SyncMessage(SyncMessage.ERROR, SyncMessage.SRCLIST); }
  },
  diffs: {
    get: function() { return new SyncMessage(SyncMessage.ERROR, SyncMessage.DIFFS); }
  },
  locked: {
    get: function() { return new SyncMessage(SyncMessage.ERROR, SyncMessage.LOCKED); }
  },
  chksum: {
    get: function() { return new SyncMessage(SyncMessage.ERROR, SyncMessage.CHKSUM); }
  },
  patch: {
    get: function() { return new SyncMessage(SyncMessage.ERROR, SyncMessage.PATCH); }
  }
});

module.exports = SyncMessage;
