var Keys = require('./Keys');
var parseTree = require('./parse-tree');
var matcher = require('./operations/matcher');
var Rx = require('rx');
var normalizePathSets = require('./operations/ranges/normalizePathSets');
var recurseMatchAndExecute = require('./run/recurseMatchAndExecute');
var optimizePathSets = require('./cache/optimizePathSets');
var pathValueMerge = require('./cache/pathValueMerge');
var runGetAction = require('./run/get/runGetAction');
var runSetAction = require('./run/set/runSetAction');
var runCallAction = require('./run/call/runCallAction');
var $atom = require('./support/types').$atom;
var get = 'get';
var set = 'set';
var call = 'call';
var MAX_REF_FOLLOW = 50;

// TODO: We should move this into the constructor.
Rx.config.longStackSupport = true;

var Router = function(routes, options) {
    var opts = options || {};

    this._routes = routes;
    this._rst = parseTree(routes);
    this._get = matcher(this._rst);
    this._set = matcher(this._rst);
    this._call = matcher(this._rst);
    this._debug = opts.debug;
    this.maxRefFollow = opts.maxRefFollow || MAX_REF_FOLLOW;
};

Router.createClass = function(routes) {
  function C(options) {
    this._debug = options.debug;
  }

  C.prototype = new Router(routes);
  C.prototype.constructor = C;

  return C;
};

Router.prototype = {
    get: function(paths) {
        var jsongCache = {};
        var action = runGetAction(this, jsongCache);
        var router = this;
        return run(this._get, action, normalizePathSets(paths), get, this, jsongCache).
            map(function(jsongEnv) {
                return materializeMissing(router, paths, jsongEnv);
            });
    },

    set: function(jsong) {
        // TODO: Remove the modelContext and replace with just jsongEnv
        // when http://github.com/Netflix/falcor-router/issues/24 is addressed
        var jsongCache = {};
        var action = runSetAction(this, jsong, jsongCache);
        var router = this;
        return run(this._set, action, jsong.paths, set, this, jsongCache).
            map(function(jsongEnv) {
                return materializeMissing(router, jsong.paths, jsongEnv);
            });
    },

    call: function(callPath, args, suffixes, paths) {
        var jsongCache = {};
        var action = runCallAction(this, callPath, args, suffixes, paths, jsongCache);
        var callPaths = [callPath];
        var router = this;
        return run(this._call, action, callPaths, call, this, jsongCache).
            map(function(jsongResult) {
                var jsongEnv = materializeMissing(
                    router,
                    callPaths,
                    jsongResult,
                    {
                        $type: $atom,
                        $expires: 0
                    });

                jsongEnv.paths = jsongResult.reportedPaths.concat(callPaths);
                return jsongEnv;
            });
    }
};

function run(matcherFn, actionRunner, paths, method, routerInstance, jsongCache) {
    return recurseMatchAndExecute(
            matcherFn, actionRunner, paths, method, routerInstance, jsongCache);
}

function materializeMissing(router, paths, jsongEnv, missingAtom) {
    var jsonGraph = jsongEnv.jsonGraph;
    var materializedAtom = missingAtom || {$type: $atom};

    // Optimizes the pathSets from the jsong then
    // inserts atoms of undefined.
    optimizePathSets(jsonGraph, paths, router.maxRefFollow).
        forEach(function(optMissingPath) {
            pathValueMerge(jsonGraph, {
                path: optMissingPath,
                value: materializedAtom
            });
        });

    return {jsonGraph: jsonGraph};
}

Router.ranges = Keys.ranges;
Router.integers = Keys.integers;
Router.keys = Keys.keys;
module.exports = Router;


