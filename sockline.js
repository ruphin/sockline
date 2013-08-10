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
    sock;

  function log(message) {
    console.log("Sockline - " + message);
  }

  function errlog(error) {
    log(error.name + ": " + error.message);
  }

  function recoverFromSocketClose(event) {
    log(event);
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
    if( Object.prototype.toString.call( messageObject ) === '[object Array]' ) {

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

  // TODO: Connect should not accept an uri. Instead, this should be configured beforehand using a configuration option.
  sockline.connect = function (socketuri) {
    sock = new WebSocket(socketuri);
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
    var found = false;
    // Register callbacks
    callbackStore.forEach(function (graph) {
      // TODO: Make a more robust comparison method
      if (JSON.stringify(graph['graphSelector']) === JSON.stringify(graphSelector)) {
        graph['successCallbacks'].push(successCallback);
        graph['errorCallbacks'].push(errorCallback);
        found = true;
      }
    })
    if (!found) {
      callbackStore.push({'graphSelector':graphSelector, 'successCallbacks':[successCallback], 'errorCallbacks':[errorCallback]})
    }

    // Send subscription message
    if (sock !== undefined) {
      sock.send(JSON.stringify({'subscribe': graphSelector}));
    } else {
      log(new Error("called subscribe before connecting"));
    }
  }

  // Unsubscribe from receiving updates for the selected graph.
  sockline.unsubscribe = function (graphSelectors) {
    // Remove callbacks
    // TODO: Remove callbacks

    // Send an unsubscription message
    if (sock !== undefined) {
      sock.send(JSON.stringify({'unsubscribe': graphSelector}));
    }
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