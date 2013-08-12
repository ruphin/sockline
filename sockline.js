(function (sockline, undefined) {

  // Callback storage format
  // [
  //   {
  //     graphSelector: {graphSelectorObject}
  //     successCallbacks: [callback*]
  //     errorCallbacks: [callback*]
  //   }
  // ]
  var callbackStore = [],
    deferreds = [],
    configuration = {},
    sock;

  function log(message) {
    console.log("Sockline - " + message);
  }

  function errlog(error) {
    log(error.name + ": " + error.message);
  }

  function recoverFromSocketClose(event) {
    log(event);
    sock = undefined;
  }

  function connected() {
    // readyState === 1 means the connection is open, as defined in http://dev.w3.org/html5/websockets
    return ((sock !== undefined) && (sock.readyState === 1));
  }

  // TODO: Merge dispatchData and dispatchError
  function dispatchData(graphSelector, data) {
    callbackStore.forEach(function (graph) {
      // TODO: Make a more robust comparison method
      if (JSON.stringify(graph['graphSelector']) === JSON.stringify(graphSelector)) {
        graph['successCallbacks'].forEach(function (callback) {
          callback.call(this, data);
        })
      }
    })
  }

  function dispatchError(graphSelector, data) {
    callbackStore.forEach(function (graph) {
      // TODO: Make a more robust comparison method
      if (JSON.stringify(graph['graphSelector']) === JSON.stringify(graphSelector)) {
        graph['errorCallbacks'].forEach(function (callback) {
          callback.call(this, data);
        })
      }
    })
  }

  // Message object format:
  // [
  //  {
  //    graphSelector: {GraphSelectorObject},
  //    result: 'success' || 'error', 
  //    data: graphData || errorMessage,
  //  }+
  // ]
  function parseMessage(message) {
    console.log("Received: " + message)
    var messageObject = JSON.parse(message);
    if (Object.prototype.toString.call(messageObject) === '[object Array]') {

      messageObject.forEach(function (data) {
        var graphSelector = data['graphSelector'];
        var result = data['result']
        if (result === 'success') {
          dispatchData(graphSelector, data['data']);
        } else if (result === 'error') {
          errlog(new Error(graphSelector.name + " received: " + data['data']));
          dispatchError(graphSelector, data['data']);
        } else {
          errlog(new Error("Unknown result '" + data['result'] + "' for " + graphselector.name))
        }
      });
    } else {
      errlog(new Error ("Received incorrectly formatted message"))
    }
  }

  function handleDeferreds() {
    deferreds.filter(function (submit) {
      return submit();
    })
  }

  // Unsubscribe from receiving updates for the selected graph.
  function unsubscribe(graphSelector, successCallback, errorCallback) {
    // Function that submits the unsubscription to the server. Returns false when done, true otherwise.
    var submitUnsubscription = function () {
      if (connected()) {
        sock.send(JSON.stringify({'unsubscribe': graphSelector}));
        return false;
      } else {
        return true;
      }
    }

    // Remove callbacks
    callbackStore.every(function (storedGraph, index) {
      // TODO: Make a more robust comparison method
      if (JSON.stringify(storedGraph['graphSelector']) === JSON.stringify(graphSelector)) {
        if (storedGraph['successCallbacks'].indexOf(successCallback) >= 0) {
          storedGraph['successCallbacks'].splice(storedGraph['successCallbacks'].indexOf(successCallback), 1);
        }
        if (storedGraph['errorCallbacks'].indexOf(errorCallback) >= 0) {
          storedGraph['errorCallbacks'].splice(storedGraph['errorCallbacks'].indexOf(errorCallback), 1);
        }
        // If this graph has no remaining callbacks, remove it from the store, and submit an unsubscription to the server.
        if (storedGraph['successCallbacks'].length + storedGraph['errorCallbacks'].length === 0) {
          callbackStore.splice(index, 1);
          if (submitUnsubscription()) {
            log("called unsubscribe while not connected - deferring");
            deferreds.push(submitUnsubscription)
          }
        }
        return false;
      } else {
        return true;
      }
    })
  }


  // TODO: Connect should not accept an uri. Instead, this should be configured beforehand using a configuration option.
  sockline.connect = function (socketuri) {
    sock = new WebSocket(socketuri);
    sock.onopen = function () { handleDeferreds(); };
    sock.onmessage = function (event) { parseMessage(event.data); };
    sock.onerror = function (event) { errlog(event); };
    sock.onclose = function (event) { recoverFromSocketClose(event); };
  }

  // GraphSelector object format:
  // {
  //   identifier: 'graph.name'
  //   begin: new Date().getTime() || undefined
  //   end: new Date().getTime() || undefined
  //   granularity: '15s' || '3m' || '5h' || '12d'
  //   update: true || false
  // }

  // Subscribe to updates for the selected graph, and attach callbacks.
  sockline.subscribe = function (graphSelector, successCallback, errorCallback) {
    var callbacks;
    var unknown_graph;

    // Function that submits the subscription to the server. Returns false when done, true otherwise.
    var submitSubscription = function () {
      if (connected()) {
        sock.send(JSON.stringify({'subscribe': graphSelector}));
        return false;
      } else {
        return true;
      }
    }

    // Register callbacks
    unknown_graph = callbackStore.every(function (storedGraph) {
      // TODO: Make a more robust comparison method
      if (JSON.stringify(storedGraph['graphSelector']) === JSON.stringify(graphSelector)) {
        storedGraph['successCallbacks'].push(successCallback);
        storedGraph['errorCallbacks'].push(errorCallback);
        return false;
      } else {
        return true;
      }
    })

    if (unknown_graph) {
      callbackStore.push({'graphSelector':graphSelector, 'successCallbacks':[successCallback], 'errorCallbacks':[errorCallback]})
      // Submit subscription or defer
      if (submitSubscription()) {
        log("called subscribe while not connected - deferring");
        deferreds.push(submitSubscription)
      }
    }

    // Return a subscription object that implements an 'unsubscribe' method.
    return {'unsubscribe': (function() { unsubscribe(graphSelector, successCallback, errorCallback); })}
  }

  // Function to test things, to be removed.
  sockline.send = function (stuff) {
    if (sock !== undefined) {
      sock.send(stuff);
    }
  }

}( window.sockline = window.sockline || {} ));


// To test, run the following snippets in the console:

// var wsUri = "ws://echo.websocket.org";
// var succ = (function (data) {console.log("Successback received: " + data)})
// var err = (function (data) {console.log("Errback received: " + data)})
// var graph = {name: 'test.graph', start: 1, end: 2, precision: '15s', update: true }
// var testMessage = JSON.stringify([{graphSelector: graph, result: 'success', data: 'This is test data1'},{graphSelector: graph, result: 'success', data: 'This is test data2'},{graphSelector: graph, result: 'error', data: 'This is a test error'}])
// window.sockline.connect(wsUri);
// window.sockline.subscribe(graph, succ, err);
// window.sockline.send(testMessage)