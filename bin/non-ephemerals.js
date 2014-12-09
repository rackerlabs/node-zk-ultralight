#! /usr/bin/env node

var async = require('async');
var zookeeper = require('node-zookeeper-client');

var argv = require('minimist')(process.argv.slice(process.argv[0].indexOf('./') === 0 ? 1 : 2), { string: 'urls' });
var urls = argv.urls || 'localhost:2181';
var roots = argv._;

roots.length > 0 || error('must set a root to search!\n');

var zk = zookeeper.createClient(urls, { sessionTimeout: 60000 });
zk.connect();

var queue = roots.slice();
var non_ephemerals = [];

async.whilst(function() { return queue.length > 0; }, function(callback) {
  var znode = queue.pop();

  if (znode.match('/zookeeper')) {
    callback();
  }

  zk.getChildren(znode, function(err, children, stats) {
    if (stats.numChildren > 0) {
      queue = queue.concat(children.map(function(c) {
        if (znode.slice(-1) !== '/') {
          c = '/' + c;
        }
        return znode + c;
      }));
    } else if (stats.ephemeralOwner.readUInt32LE(0) == 0) {
      non_ephemerals.push(znode);
    }
    callback(err);
  });
}, function(err) {
  zk.close();

  if (err) {
    error(err);
  }
  process.stdout.write(JSON.stringify(non_ephemerals, 0, 2) + '\n');
  process.exit(0);
});

function error(msg) {
  process.stderr.write(msg + '\n');
  process.exit(1);
}