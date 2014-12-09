[![travis](https://api.travis-ci.org/rackerlabs/zk-ultralight.svg?branch=master)](https://travis-ci.org/rackerlabs/zk-ultralight)

## What's so special about this zookeeper locking library?

This locking library is based on [the ZooKeeper lock recipe.](http://zookeeper.apache.org/doc/trunk/recipes.html#sc_recipes_Locks) with one key difference: the lock nodes it creates are ephemeral.

The ZK lock recipe recommends negotiating for the lock under the requested lock node with child nodes like `_locknode_/guid-lock-<sequence number>`. However, [ephemeral nodes may not have children](http://zookeeper.apache.org/doc/r3.2.1/zookeeperProgrammers.html#Ephemeral+Nodes), and non-ephemeral state impacts zookeeper's speed in recovering from network partitions, so applications with a large number of unique locks, especially a monotonically increasing number of locks (as when locking on a unique timestamp), pose a management problem. `zk-ultralight` is meant to provide locking with less production impact.

## Usage

```javascript
function somethingAsyncHappens(callback) {
  var cxn = zkultra.getCxn(settings.ZOOKEEPER_URLS);
  async.series([
    cxn.lock.bind(cxn, '/some/lock/i/need', process.title +'-'+ process.pid),
    someAsyncAction,
    cxn.unlock.bind(cxn, '/some/lock/i/need')
  ], callback);
};
```

### bin/

`bin/non-ephemerals.js` prints a JSON array of the non-ephemeral nodes in your zookeeper cluster to stdout. You can run it in the vm after running the test suite to see the non-ephemerals left after the tests:

```
$ bin/non-ephemerals.js /
[
  "/plum",
  "/dog",
  "/foo/bar",
  "/plumber",
  "/111",
  "/apple",
  "/cat"
]
```

`bin/rm-znodes.js` accepts a JSON array of znodes on stdin and removes them from your zookeeper cluster. The usual usage will be `bin/non-ephemerals.js / | bin/rm-znodes.js` to remove all non-ephemeral nodes without children. Sequential runs will eventually remove all znode subtrees which do not contain ephemeral nodes.

## Development

The Vagrantfile ships a vm with a running zookeeper instance, which is all you need to run tests.

### Tests

`npm test`

### Lint

`npm run-script lint`

### Coverage

`npm run-script coverage`

# License

Library is distributed under the [Apache license](http://www.apache.org/licenses/LICENSE-2.0.html).

[![downloades](https://nodei.co/npm-dl/zk-ultralight.png)](https://nodei.co/npm-dl/zk-ultralight/)
