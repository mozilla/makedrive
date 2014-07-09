// Constructor
function SyncMessage(type, name, content) {
  if(!isValidType(type)) {
    throw "Invalid type";
  }
  if(!isValidName(name)) {
    throw "Invalid name";
  }

  this.type = type;
  this.name = name;
  this.content = content || null;
}

SyncMessage.prototype.stringify = function() {
  return JSON.stringify(this);
};

// Try to parse data back into a SyncMessage object. If the
// data is invalid, return a format error message instead.
SyncMessage.parse = function(data) {
  if(!data || !isValidType(data.type) || !isValidName(data.name)) {
    return SyncMessage.error.formt;
  }

  return new SyncMessage(data.type, data.name, data.content);
};

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

function isValidName(name) {
  return name === SyncMessage.SRCLIST ||
         name === SyncMessage.CHKSUM  ||
         name === SyncMessage.DIFFS   ||
         name === SyncMessage.LOCKED  ||
         name === SyncMessage.PATCH   ||
         name === SyncMessage.SYNC    ||
         name === SyncMessage.RESET   ||
         name === SyncMessage.AUTHZ   ||
         name === SyncMessage.IMPL    ||
         name === SyncMessage.INFRMT  ||
         name === SyncMessage.INCONT;
}

function isValidType(type) {
  return type === SyncMessage.REQUEST  ||
         type === SyncMessage.RESPONSE ||
         type === SyncMessage.ERROR;
}

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
  },
  impl: {
    get: function() { return new SyncMessage(SyncMessage.ERROR, SyncMessage.IMPL); }
  },
  format: {
    get: function() {
      return new SyncMessage(SyncMessage.ERROR,
                             SyncMessage.INFRMT,
                             'Message must be formatted as a sync message');
    }
  },
  content: {
    get: function() {
      return new SyncMessage(SyncMessage.ERROR,
                             SyncMessage.INCONT,
                             'Invalid content provided');
    }
  }
});

module.exports = SyncMessage;
