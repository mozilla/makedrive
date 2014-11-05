// Constructor
function SyncMessage(type, name, content) {
  if(!SyncMessage.isValidType(type)) {
    throw "Invalid type";
  }
  if(!SyncMessage.isValidName(name)) {
    throw "Invalid name";
  }

  this.type = type;
  this.name = name;
  this.content = content || null;

  // Sugar for testing instance data
  var that = this;
  this.is = {
    // Types
    get request() {
      return that.type === SyncMessage.REQUEST;
    },
    get response() {
      return that.type === SyncMessage.RESPONSE;
    },
    get error() {
      return that.type === SyncMessage.ERROR;
    },

    // Names
    get sourceList() {
      return that.name === SyncMessage.SOURCELIST;
    },
    get sync() {
      return that.name === SyncMessage.SYNC;
    },
    get checksums() {
      return that.name === SyncMessage.CHECKSUMS;
    },
    get diffs() {
      return that.name === SyncMessage.DIFFS;
    },
    get patch() {
      return that.name === SyncMessage.PATCH;
    },
    get verification() {
      return that.name === SyncMessage.VERIFICATION;
    },
    get reset() {
      return that.name === SyncMessage.RESET;
    },
    get locked() {
      return that.name === SyncMessage.LOCKED;
    },
    get authz() {
      return that.name === SyncMessage.AUTHZ;
    },
    get impl() {
      return that.name === SyncMessage.IMPL;
    },
    get content() {
      return that.name === SyncMessage.INCONT;
    },
    get serverReset() {
      return that.name === SyncMessage.SERVER_RESET;
    },
    get downstreamLocked() {
      return that.name === SyncMessage.DOWNSTREAM_LOCKED;
    },
    get fileSizeError() {
      return that.type === SyncMessage.ERROR && that.name === SyncMessage.MAXSIZE;
    },
    get root() {
      return that.name === SyncMessage.ROOT;
    },
    get needsDownstream() {
      return that.type === SyncMessage.ERROR && that.name === SyncMessage.NEEDS_DOWNSTREAM;
    },
    get interrupted() {
      return that.name === SyncMessage.INTERRUPTED;
    },
    get delay() {
      return that.type === SyncMessage.REQUEST && that.name === SyncMessage.DELAY;
    },
    get rename() {
      return that.name === SyncMessage.RENAME;
    },
    get del() {
      return that.name === SyncMessage.DEL;
    }
  };
}

SyncMessage.isValidName = function(name) {
  return name === SyncMessage.SOURCELIST           ||
         name === SyncMessage.CHECKSUMS            ||
         name === SyncMessage.DIFFS                ||
         name === SyncMessage.LOCKED               ||
         name === SyncMessage.PATCH                ||
         name === SyncMessage.VERIFICATION         ||
         name === SyncMessage.SYNC                 ||
         name === SyncMessage.RESET                ||
         name === SyncMessage.AUTHZ                ||
         name === SyncMessage.IMPL                 ||
         name === SyncMessage.INFRMT               ||
         name === SyncMessage.INCONT               ||
         name === SyncMessage.SERVER_RESET         ||
         name === SyncMessage.DOWNSTREAM_LOCKED    ||
         name === SyncMessage.MAXSIZE              ||
         name === SyncMessage.ROOT                 ||
         name === SyncMessage.NEEDS_DOWNSTREAM     ||
         name === SyncMessage.INTERRUPTED          ||
         name === SyncMessage.DELAY                ||
         name === SyncMessage.RENAME               ||
         name === SyncMessage.DEL;
};

SyncMessage.isValidType = function(type) {
  return type === SyncMessage.REQUEST  ||
         type === SyncMessage.RESPONSE ||
         type === SyncMessage.ERROR;
};

SyncMessage.prototype.stringify = function() {
  return JSON.stringify({
    type: this.type,
    name: this.name,
    content: this.content
  });
};

// Try to parse data back into a SyncMessage object. If the
// data is invalid, return a format error message instead.
SyncMessage.parse = function(data) {
  if(!data                               ||
     !SyncMessage.isValidType(data.type) ||
     !SyncMessage.isValidName(data.name)) {
    return SyncMessage.error.format;
  }

  return new SyncMessage(data.type, data.name, data.content);
};

// SyncMessage Type constants
SyncMessage.REQUEST = "REQUEST";
SyncMessage.RESPONSE = "RESPONSE";
SyncMessage.ERROR = "ERROR";

// SyncMessage Name constants
SyncMessage.SOURCELIST = "SOURCELIST";
SyncMessage.SYNC = "SYNC";
SyncMessage.CHECKSUMS = "CHECKSUMS";
SyncMessage.DIFFS = "DIFFS";
SyncMessage.PATCH = "PATCH";
SyncMessage.VERIFICATION = "VERIFICATION";
SyncMessage.RESET = "RESET";
SyncMessage.LOCKED = "LOCKED";
SyncMessage.AUTHZ = "AUTHORIZED";
SyncMessage.IMPL = "IMPLEMENTATION";
SyncMessage.SERVER_RESET = "SERVER_RESET";
SyncMessage.DOWNSTREAM_LOCKED = "DOWNSTREAM_LOCKED";
SyncMessage.MAXSIZE = "MAXSIZE";
SyncMessage.INTERRUPTED = "INTERRUPTED";
SyncMessage.ROOT = "ROOT";
SyncMessage.NEEDS_DOWNSTREAM = "NEEDS DOWNSTREAM";
SyncMessage.DELAY = "DELAY DOWNSTREAM";
SyncMessage.RENAME = "RENAME";
SyncMessage.DEL = "DELETE";

// SyncMessage Error constants
SyncMessage.INFRMT = "INVALID FORMAT";
SyncMessage.INCONT = "INVALID CONTENT";

// Sugar for getting message instances
SyncMessage.request = {
  get diffs() {
    return new SyncMessage(SyncMessage.REQUEST, SyncMessage.DIFFS);
  },
  get checksums() {
    return new SyncMessage(SyncMessage.REQUEST, SyncMessage.CHECKSUMS);
  },
  get sync() {
    return new SyncMessage(SyncMessage.REQUEST, SyncMessage.SYNC);
  },
  get reset() {
    return new SyncMessage(SyncMessage.REQUEST, SyncMessage.RESET);
  },
  get delay() {
    return new SyncMessage(SyncMessage.REQUEST, SyncMessage.DELAY);
  },
  get rename() {
    return new SyncMessage(SyncMessage.REQUEST, SyncMessage.RENAME);
  },
  get del() {
    return new SyncMessage(SyncMessage.REQUEST, SyncMessage.DEL);
  }
};
SyncMessage.response = {
  get diffs() {
    return new SyncMessage(SyncMessage.RESPONSE, SyncMessage.DIFFS);
  },
  get patch() {
    return new SyncMessage(SyncMessage.RESPONSE, SyncMessage.PATCH);
  },
  get verification() {
    return new SyncMessage(SyncMessage.RESPONSE, SyncMessage.VERIFICATION);
  },
  get authz() {
    return new SyncMessage(SyncMessage.RESPONSE, SyncMessage.AUTHZ);
  },
  get sync() {
    return new SyncMessage(SyncMessage.RESPONSE, SyncMessage.SYNC);
  },
  get reset() {
    return new SyncMessage(SyncMessage.RESPONSE, SyncMessage.RESET);
  },
  get root() {
    return new SyncMessage(SyncMessage.RESPONSE, SyncMessage.ROOT);
  }
};
SyncMessage.error = {
  get sourceList() {
    return new SyncMessage(SyncMessage.ERROR, SyncMessage.SOURCELIST);
  },
  get diffs() {
    return new SyncMessage(SyncMessage.ERROR, SyncMessage.DIFFS);
  },
  get locked() {
    return new SyncMessage(SyncMessage.ERROR, SyncMessage.LOCKED);
  },
  get checksums() {
    return new SyncMessage(SyncMessage.ERROR, SyncMessage.CHECKSUMS);
  },
  get patch() {
    return new SyncMessage(SyncMessage.ERROR, SyncMessage.PATCH);
  },
  get impl() {
    return new SyncMessage(SyncMessage.ERROR, SyncMessage.IMPL);
  },
  get serverReset() {
    return new SyncMessage(SyncMessage.ERROR, SyncMessage.SERVER_RESET);
  },
  get downstreamLocked() {
    return new SyncMessage(SyncMessage.ERROR, SyncMessage.DOWNSTREAM_LOCKED, 'Downstream syncs are locked!');
  },
  get maxsizeExceeded() {
    return new SyncMessage(SyncMessage.ERROR, SyncMessage.MAXSIZE, 'Maximum file size exceeded');
  },
  get verification() {
    return new SyncMessage(SyncMessage.ERROR,
                           SyncMessage.VERIFICATION,
                           'Patch could not be verified');
  },
  get format() {
    return new SyncMessage(SyncMessage.ERROR,
                           SyncMessage.INFRMT,
                           'Message must be formatted as a sync message');
  },
  get content() {
    return new SyncMessage(SyncMessage.ERROR,
                           SyncMessage.INCONT,
                           'Invalid content provided');
  },
  get interrupted() {
    return new SyncMessage(SyncMessage.ERROR, SyncMessage.INTERRUPTED);
  },
  get needsDownstream() {
    return new SyncMessage(SyncMessage.ERROR, SyncMessage.NEEDS_DOWNSTREAM);
  },
  get rename() {
    return new SyncMessage(SyncMessage.ERROR, SyncMessage.RENAME);
  },
  get del() {
    return new SyncMessage(SyncMessage.ERROR, SyncMessage.DEL);
  }
};

SyncMessage.prototype.invalidContent = function(keys) {
  var content = this.content;
  keys = keys || [];

  if(!content || !content.path) {
    return true;
  }

  for(var i = 0; i < keys.length; i++) {
    if(!content[keys[i]]) return true;
  }

  return false;
};

module.exports = SyncMessage;
