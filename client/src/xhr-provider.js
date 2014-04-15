define(function(require) {
  var FILE_SYSTEM_NAME = require('src/constants').FILE_SYSTEM_NAME;
  var FILE_STORE_NAME = require('src/constants').FILE_STORE_NAME;
  var u8toArray = require('src/shared').u8toArray;
  var Errors = require('src/errors');

  function XHRContext(db, isReadOnly) {
    this.isReadOnly = isReadOnly;
  }
  XHRContext.prototype.clear = function(callback) {
    // TODO: do we want to support clear?
    callback(new Error('clear is not supported on XHRContext');
  };
  XHRContext.prototype.get = function(key, callback) {
    var request = new XMLHttpRequest();
    request.addEventListener("load", function() {
      var data = new Uint8Array(request.response);
      fs.writeFile(path, data, function(err) {
        if(err) {
          callback(err);
        } else {
          callback(null, path);
        }
      });
    }, false);
    request.addEventListener("error", function(err) { callback(err); }, false);
    request.open("GET", url);
    request.responseType = "arraybuffer";
    request.send();


    function onSuccess(transaction, result) {
      // If the key isn't found, return null
      var value = result.rows.length === 0 ? null : result.rows.item(0).data;
      try {
        if(value) {
          value = JSON.parse(value);
          // Deal with special-cased flattened typed arrays in WebSQL (see put() below)
          if(value.__isUint8Array) {
            value = new Uint8Array(value.__array);
          }
        }
        callback(null, value);
      } catch(e) {
        callback(e);
      }
    }
    function onError(transaction, error) {
      callback(error);
    }
    this.getTransaction(function(transaction) {
      transaction.executeSql("SELECT data FROM " + FILE_STORE_NAME + " WHERE id = ?;",
                             [key], onSuccess, onError);
    });
  };
  XHRContext.prototype.put = function(key, value, callback) {
    // We do extra work to make sure typed arrays survive
    // being stored in the db and still get the right prototype later.
    if(Object.prototype.toString.call(value) === "[object Uint8Array]") {
      value = {
        __isUint8Array: true,
        __array: u8toArray(value)
      };
    }
    value = JSON.stringify(value);
    function onSuccess(transaction, result) {
      callback(null);
    }
    function onError(transaction, error) {
      callback(error);
    }
    this.getTransaction(function(transaction) {
      transaction.executeSql("INSERT OR REPLACE INTO " + FILE_STORE_NAME + " (id, data) VALUES (?, ?);",
                             [key, value], onSuccess, onError);
    });
  };
  WebSQLContext.prototype.delete = function(key, callback) {
    function onSuccess(transaction, result) {
      callback(null);
    }
    function onError(transaction, error) {
      callback(error);
    }
    this.getTransaction(function(transaction) {
      transaction.executeSql("DELETE FROM " + FILE_STORE_NAME + " WHERE id = ?;",
                             [key], onSuccess, onError);
    });
  };


  function XHR() {
  }
  XHR.isSupported = function() {
    return !!window.XMLHttpRequest;
  };

  XHR.prototype.open = function(callback) {
    var that = this;

    // TODO: Webmaker user auth/verify...
  };
  XHR.prototype.getReadOnlyContext = function() {
    return new XHRContext(this.db, true);
  };
  XHR.prototype.getReadWriteContext = function() {
    return new XHRContext(this.db, false);
  };

  return XHR;
});
