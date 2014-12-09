#! /usr/bin/env node

var async = require('async');
var concat = require('concat-stream');
var zookeeper = require('node-zookeeper-client');

var argv = require('minimist')(process.argv.slice(process.argv[0].indexOf('./') === 0 ? 1 : 2), { string: 'urls' });
var urls = argv.urls || 'localhost:2181';

process.stdin.pipe(concat(function(stdin) {
  var znodes = JSON.parse(stdin);
  var zk = zookeeper.createClient(urls, { sessionTimeout: 60000 });
  zk.connect();

  async.each(znodes, function(zn, callback) {
    zk.remove(zn, callback);
  }, function(err) {
    if (err) {
      console.error(err);
    }
    setTimeout(function() {
      // node-zookeeper-client has some bugs in close() when messages are enqueued,
      // don't want to call close() too rapidly after a transaction or:
        // TypeError: Cannot call method 'write' of undefined
        // at ConnectionManager.onPacketQueueReadable (/vagrant/node_modules/node-zookeeper-client/lib/ConnectionManager.js:624:26)
        // at PacketQueue.EventEmitter.emit (events.js:92:17)
        // at PacketQueue.push (/vagrant/node_modules/node-zookeeper-client/lib/PacketQueue.js:35:10)
        // at ConnectionManager.queue (/vagrant/node_modules/node-zookeeper-client/lib/ConnectionManager.js:711:30)
        // at ConnectionManager.close (/vagrant/node_modules/node-zookeeper-client/lib/ConnectionManager.js:248:10)
        // at Client.close (/vagrant/node_modules/node-zookeeper-client/index.js:229:28)
      zk.close();
      if (err) {
        process.exit(1);
      }
      process.exit(0);
    }, 500);
  });
}));