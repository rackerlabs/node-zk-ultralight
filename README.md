# Ultralight ZK locking utility

Slimmer profile, low-calorie distributed locking library based on [racker/node-zookeeper-client](https://github.com/racker/node-zookeeper-client) and [alexguan/node-zookeeper-client](https://github.com/alexguan/node-zookeeper-client)

<a href="https://nodei.co/npm-dl/zk-ultralight/"><img src="https://nodei.co/npm-dl/zk-ultralight.png"></a>
[![Dependency Status](https://david-dm.org/rackerlabs/node-zk-ultralight.png)](https://david-dm.org/rackerlabs/node-zk-ultralight)

## Why a new library?

* Mildly different, much smaller interface
* Fewer features (no master election)
* Incompatible locking strategy
* Uses a pure JS ZK client

## Locking strategy

Like `node-zookeeper-client`, `node-zk-ultralight`'s locking is based on [the ZooKeeper lock recipe.](http://zookeeper.apache.org/doc/trunk/recipes.html#sc_recipes_Locks)

The key difference: the ZK lock recipe recommends negotiating for the lock under the requested lock node with child nodes like `_locknode_/guid-lock-<sequence number>`. However, [ephemeral nodes may not have children](http://zookeeper.apache.org/doc/r3.2.1/zookeeperProgrammers.html#Ephemeral+Nodes), and non-ephemeral state impacts zookeeper's speed in recovering from network partitions, so applications with a large number of unique locks, especially a monotonically increasing number of locks (as when locking on a unique timestamp), pose a management problem. Locks created with node-zk-ultralight are ephemeral, and when no longer needed, they'll evaporate like the morning dew with the sunrise.

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
