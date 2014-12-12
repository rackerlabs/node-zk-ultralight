#! /usr/bin/env node

var async = require('async');
var zookeeper = require('node-zookeeper-client');
var binary = require('binary');

var argv = require('minimist')(process.argv.slice(process.argv[0].indexOf('./') === 0 ? 1 : 2), { string: 'urls' });
var urls = argv.urls || 'localhost:2181';

// Default: 2 weeks. Compares against stats.mtime which is:
// "The time in milliseconds from epoch when this znode was last modified"
// https://zookeeper.apache.org/doc/r3.1.2/zookeeperProgrammers.html
var since = argv.since || 14 * 24 * 60 * 60 * 1000;

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
    } else {
      // https://github.com/alexguan/node-zookeeper-client/blob/9b826c9e2283fb67845792d8b56fa8554f1d70a9/lib/jute/index.js#L378
      var s = {};

      s.eo = binary.parse(stats.ephemeralOwner).word64bu('v').vars;
      s.mt = binary.parse(stats.mtime).word64bu('v').vars;

      if (s.eo.v == 0 && s.mt.v < Date.now() - since) {
        non_ephemerals.push(znode);
      }
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