/*
Copyright 2013 Rackspace Hosting, Inc

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

   http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

/**
 * @description
 *
 * Module interface:
 * - ZkCXN = exports.getCxn(zkUrls, cxnTimeout)
 * - exports.shutdown(callback)
 *
 * ZkCxn:
 * - lock(name, txnId, callback)
 * - unlock(name, callback)
 *
 * Public methods on ZkCxn you probably do not need to call:
 * - onConnection(callback)
 * - close(callback)
 */

/**
 * @example
var zkultra = require('zk-ultralight');
var cxn = zkultra.getCxn(['127.0.0.1:2181']);
function performActionWithLock(callback) {
  async.series([
    cxn.lock.bind(cxn, '/critical/section', 'vroom'),
    performAction,
    cxn.unlock.bind(cxn, '/critical/section')
  ], callback);
}
 */

var util = require('util');
var events = require('events');
var async = require('async');
var _ = require('underscore');
var zookeeper = require('node-zookeeper-client');
var log = require('logmagic').local('zk-ultralight');


// used for onConnection callbacks which is both lock and unlock
var DEFAULT_TIMEOUT = 16000;

// TODO: use _.memoize instead?
var cxns = {}; // urls -> ZkCxn

/**
 * @param {Array} zkUrls Array of strings like '127.0.0.1:999' for ZK servers to connect to.
 * @param {Number} timeout ZK session timeout.
*/
exports.getCxn = function getCxn(zkUrls, timeout) {
  var urls = zkUrls.join(',');
  log.trace1('getCxn');
  if (!cxns[urls]) {
    cxns[urls] = new ZkCxn(urls, timeout);
  }
  return cxns[urls];
};


/**
 * Close all open connections. Call prior to exit.
 * @param {Function} callback A callback called on completion.
 */
exports.shutdown = function shutdown(callback) {
  log.trace1('shutdown');
  var toClose = _.values(cxns);
  cxns = {};
  async.forEach(toClose, function(cxn, callback) {
    cxn.close(function closing(err) {
      if (err) {
        log.trace1('Error observed mid-shutdown', { error: err });
      }
      callback(); // suppress the error on shutdown
    });
  }, callback);
};


/**
 * Export ZkCxn
 */
exports.ZkCxn = ZkCxn;


/*
 * @constructor
 * @params {String} urls A comma-delimited array of <ZK host:port>s.
 * @params {?Number} timeout A timeout.
 */
function ZkCxn(urls, timeout) {
  this._locks = {}; // lockname -> lock node
  this._urls = urls;
  this._options = {}; // passed to this._zk on creation
  if (timeout) {
    this._options.sessionTimeout = timeout;
  }
  this._timeout = timeout || DEFAULT_TIMEOUT; // used for onConnection callbacks. TODO: break out to distinct parameter?
  this._cxnState = this.cxnStates.CLOSED; // initial state
  this._stateEmitter = undefined; // created on connect
  this._zk = undefined; // instance of node-zookeeper-client
}


/** An enum of states the connection can be in. */
ZkCxn.prototype.cxnStates = {
  ERROR: 'ERROR',
  CLOSED: 'CLOSED',
  CONNECTING: 'CONNECTING',
  CONNECTED: 'CONNECTED'
};


/**
 * @param {String} to The cxnStates value to change to.
 * @param {?Object} data An optional data object (i.e. err) associated with the state change.
 */
ZkCxn.prototype._changeState = function(to, data) {
  if (this._cxnState === to && to !== this.cxnStates.ERROR) {
    // call it good
    return;
  }
  log.trace1f('ZkCxn._changeState', { from: this._cxnState, to: to, data: data });
  this._cxnState = to;
  if (this._stateEmitter) {
    this._stateEmitter.emit(to, data);
  }
};


/**
 * When connected, call this callback. Times out after this._timeout.
 * TODO: Should this really be public?
 * @param {Function} callback A function taking (err).
 */
ZkCxn.prototype.onConnection = function(callback) {
  var self = this;
  log.trace1('ZkCxn.onConnection', { callback: callback.name });

  callback = _.once(callback);
  callback = (function(callback) {
    var timerId = setTimeout(function onconnectTimeout() {
      var error = new Error("Timed out after "+ self._timeout);
      self._changeState(self.cxnStates.ERROR, error);
      callback(error);
    }, self._timeout);
    return function(err) {
      if (err) {
        log.trace1('Error while waiting for connection', { err: err });
      }
      clearTimeout(timerId);
      callback.apply(null, arguments);
    };
  })(callback);

  switch (this._cxnState) {
    case this.cxnStates.ERROR: // reconnecting after error
    case this.cxnStates.CLOSED: // initial state
      this._connect();
      this._stateEmitter.once(this.cxnStates.CONNECTED, function() {
        callback();
      });
      this._stateEmitter.once(this.cxnStates.ERROR, function(err) {
        callback(err);
      });
      break;
    case this.cxnStates.CONNECTING:
      this._stateEmitter.once(this.cxnStates.CONNECTED, function() {
        callback();
      });
      this._stateEmitter.once(this.cxnStates.ERROR, function(err) {
        callback(err);
      });
      break;
    case this.cxnStates.CONNECTED:
      _.defer(callback);
      break;
  }
};


ZkCxn.prototype._connect = function() {
  var self = this;
  log.trace1('ZkCxn._connect');
  switch (this._cxnState) {
    case this.cxnStates.ERROR: // reconnecting after error
    case this.cxnStates.CLOSED: // initial state
      this._stateEmitter = new events.EventEmitter();
      if (this._zk) {
        this._zk.close();
      }
      this._zk = zookeeper.createClient(this._urls, this._options);
      this._zk.on('connected', function() {
        self._changeState(self.cxnStates.CONNECTED, 'connected');
      });
      this._zk.on('disconnected', function() {
        self._changeState(self.cxnStates.CLOSED, 'disconnected');
      });
      this._zk.on('connectedReadOnly', function() {
        self._changeState(self.cxnStates.ERROR, 'connectedReadOnly');
      });
      this._zk.on('expired', function() {
        self._changeState(self.cxnStates.ERROR, 'expired');
      });
      this._zk.on('authenticationFailed', function() {
        self._changeState(self.cxnStates.ERROR, 'authenticationFailed');
      });
      this._zk.connect();
      this._changeState(this.cxnStates.CONNECTING);
      break;
    case this.cxnStates.CONNECTING:
    case this.cxnStates.CONNECTED:
      log.warning('Unexpected state in _connect!', { state: this._cxnState });
      break;
  }
};


/**
 * Locking loosely based on:
 * http://zookeeper.apache.org/doc/trunk/recipes.html#sc_recipes_Locks
 *
 * Doesn't negotiate for locks with children of the lock-path node
 * as then the lock-path node can't be ephemeral. Instead, concatenate
 * sequence ids to the lock path to negotiate for locks.
 *
 * Waits for the lock to become available.
 *
 * @param {String} name The fully-qualified lock path.
 * @param {String|Buffer} txnId Transaction identifier, written to the lock node, good for debugging.
 * @param {Function} callback A function(error) called on lock acquisition.
 */
ZkCxn.prototype.lock = function(name, txnId, callback) {
  var self = this;
  log.trace1('ZkCxn.lock', { lock: name, txnId: txnId, callback: callback.name });

  if (name[0] !== '/') {
    callback(new Error('A zookeeper path must begin with "/" !'));
    return;
  }

  // convert txnId to Buffer if it is a string
  txnId = typeof txnId === 'string' ? Buffer(txnId) : txnId;

  this.onConnection(function locking(err) {
    var lockpath = name.lastIndexOf('/') === 0 ? '/' : name.slice(0, name.lastIndexOf('/') + 1);
    if (err || self._cxnState !== self.cxnStates.CONNECTED) {
      callback(err || new Error("(1) Error occurred while attempting to lock "+ name));
      return;
    }

    async.auto({
      // ensure the parent path exists
      'path': function(callback) {
        if (self._cxnState !== self.cxnStates.CONNECTED) {
          callback(new Error("(2) Error occurred while attempting to lock "+ name));
          return;
        }
        try {
          // client doesn't like paths ending in /, so chop it off if lockpath != '/'
          self._zk.mkdirp(lockpath.length <= 1 ? lockpath : lockpath.slice(0, -1), callback);
        } catch (err) {
          callback(err);
        }
      },
      // create a node in the lock queue
      'node': ['path', function(callback) {
        if (self._cxnState !== self.cxnStates.CONNECTED) {
          callback(new Error("(3) Error occurred while attempting to lock "+ name));
          return;
        }
        try {
          self._zk.create(name, txnId, null, zookeeper.CreateMode.EPHEMERAL_SEQUENTIAL, callback);
        } catch (err) {
          callback(err);
        }
      }],
      // then negotiate for the lock
      'lock': ['node', function(callback, results) {
        if (self._cxnState !== self.cxnStates.CONNECTED) {
          callback(new Error("(4) Error occurred while attempting to lock "+ name));
          return;
        }
        self._negotiateLock(name, results, callback);
      }]
    }, callback);
  });
};


// the locking protocol, still hacky, needs <3, works though
ZkCxn.prototype._negotiateLock = function(name, results, callback) {
  var
    locked = false, self = this,
    lockpath = name.slice(0, name.lastIndexOf('/') + 1),
    lockname = name.slice(name.lastIndexOf('/') + 1);

  async.until(function() { return locked; }, function(callback) {
    callback = _.once(callback);
    if (self._cxnState !== self.cxnStates.CONNECTED) {
      callback(new Error("(5) Error occurred while attempting to lock "+ name));
      return;
    }
    self._zk.getChildren(lockpath.length <= 1 ? lockpath : lockpath.slice(0, -1), function(err, children) {
      if (err || self._cxnState !== self.cxnStates.CONNECTED) {
        log.error('Error obtaining children.', {error: err, path: lockpath, name: lockname});
        callback(new Error('Error obtaining children: ' + err));
        return;
      }

      var
        position = results.node.slice(lockpath.length + lockname.length),
        nextLowest, matchingChildren, sequenceNumbers;

      // return only children matching this lock
      matchingChildren = children.filter(function(n) { return n.indexOf(lockname) !== -1; });
      // get only the sequence number
      sequenceNumbers = matchingChildren.map(function(n) { return n.slice(lockname.length); });
      sequenceNumbers = sequenceNumbers.sort();

      // see if ours is the lowest
      if (position === sequenceNumbers[0]) {
        // If the pathname created in step 1 has the lowest sequence number suffix,
        // the client has the lock and the client exits the protocol.
        log.trace1f('${name} locked on ${node}', {name: name, node: results.node});
        self._locks[name] = results.node;
        locked = true;
        callback();
        return;
      }

      nextLowest = sequenceNumbers[_.indexOf(sequenceNumbers, position, true) - 1];
      if (nextLowest) {
        // turn the sequence number back into a node name
        nextLowest = lockpath + lockname + nextLowest;

        // The client calls exists( ) with the watch flag set on the path
        // in the lock directory with the next lowest sequence number.
        self._zk.exists(nextLowest, function watcher(msg) {
          // Otherwise, wait for a notification for the pathname
          // from the previous step before going to step 2.
          // `callback` is passed above, self._zk will call it when the pathname changes
          callback();
        }, function(err, exists) {
          if (!exists) {
            // if exists( ) returns false, go to step 2.
            callback();
            return;
          }
          return;
        });
      }
    });
  }, callback);
};


/**
 * Unlock the lock <name>.
 * @param {String} name The fully-qualified lock path.
 * @param {Function} callback A callback called upon completion.
 */
ZkCxn.prototype.unlock = function(name, callback) {
  var self = this;
  log.trace1('ZkCxn.unlock', { name: name, path: self._locks[name] });
  this.onConnection(function unlocking(err) {
    if (err || self._cxnState !== self.cxnStates.CONNECTED) {
      callback(err || new Error("Error occurred while attempting to unlock "+ name));
      return;
    }
    if (!self._locks[name]) {
      callback(new Error("Don't have lock " + name + "!"));
      return;
    }
    self._zk.remove(self._locks[name], function(err) {
      delete self._locks[name]; // race condition on double remove?
      callback(err, name);
    });
  });
};


/**
 * Closes the connection.
 * TODO: Should this be public?
 * @param {Function} callback A callback(err) called when closed.
 */
ZkCxn.prototype.close = function(callback) {
  log.trace1('ZkCxn.close', { state: this._cxnState, callback: callback.name });
  switch (this._cxnState) {
    case this.cxnStates.CONNECTED:
      this._zk.close();
      this._zk = null;
      this._changeState(this.cxnStates.CLOSED);
      callback();
      break;
    case this.cxnStates.ERROR:
      if (this._zk) {
        this._zk.close();
        this._zk = null;
      }
      this._changeState(this.cxnStates.CLOSED);
      callback();
      break;
    case this.cxnStates.CLOSED:
      if (this._zk) {
        // this is reachable if a 'disconnected' event is sent by this._zk
        this._zk.close();
        this._zk = null;
      }
      callback(); // call it good
      break;
    case this.cxnStates.CONNECTING:
      this._zk.close();
      this._zk = null;
      this._changeState(this.cxnStates.CLOSED);
      callback();
      break;
  }
};
