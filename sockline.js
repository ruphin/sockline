(function (sockline, undefined) {

  // GraphSelector object format:
  // {
  //   identifier: 'graph.name'
  //   from: new Date().getTime() || '-5s' || '-2m' || '-6h' || '-14d'
  //   until: new Date().getTime() || '-5s' || '-2m' || '-6h' || '-14d' || 'now'
  //   granularity: '15s' || '3m' || '5h' || '12d'
  // }

  // When begin is an absolute timestamp, end must also be an absolute timestamp
  // begin: absolute timestamp
  // end: absolute timestamp

  // When begin is a relative timestamp, end must also be a relative timestamp, or 'now'
  // begin: relative timestamp
  // end: relative timestamp || 'now'

  // Callback storage format
  // [
  //   {
  //     graphSelector: {graphSelectorObject}
  //     success: [callback,]
  //     error: [callback,]
  //   },
  // ]
  var subCallbacks = [];
  var getCallbacks = [];

  // A queue of messages that have been deferred until sockline is connected
  // Each message is contained in a lambda that attempts to submit the message, and returns true if it needs to be resubmitted later.
  var deferreds = [];

  // Configuration object
  // TODO: Define and use this
  var configuration = {};

  // The WebSocket connection to the server
  var sock;

  // Log a message to the console
  function log(message) {
    console.log("Sockline - " + message);
  }

  // Log an error to the console
  function errlog(error) {
    log(error.name + ": " + error.message);
  }

  // Handle closing of the socket
  // TODO: Do something useful, like exposing a hook to the user
  function recoverFromSocketClose(event) {
    log(event);
    sock = undefined;
  }

  // Return the connection state to the server. 
  // Returns true if the connection is established and open.
  function connected() {
    // readyState === 1 means the connection is open, as defined in http://dev.w3.org/html5/websockets
    return ((sock !== undefined) && (sock.readyState === 1));
  }

  // Dispatch a get response to the correct callbacks. 
  // Removes the found graphSelector with it's callbacks from the getCallbacks
  function dispatchGet(getResponse) {
    getResponse.forEach(function (get) {
      var selector = JSON.stringify(get['graphSelector'])
      getCallbacks.every(function (callbacks, index) {
        if (JSON.stringify(callbacks['graphSelector']) === selector) {
          getCallbacks.splice(index, 1)
          
          if (get['result'] === 'success') {
            callbacks['success'].forEach(function (callback) {
              callback.call(undefined, get['data'])
            })
          } else if (get['result'] === 'error') {
            callbacks['error'].forEach(function (callback) {
              errlog(new Error("Get " + selector + " received error: " + data['data']));
              callback.call(undefined, get['data'])
            })
          } else {
            errlog(new Error("Get " + selector + " received unknown result: " + get['result']));
          }
          return false;
        } else {
          return true;
        }
      })
    })
  }

  // Dispatch a subscription response to the correct callbacks
  function dispatchSubscription(subscriptions) {
    subscriptions.forEach(function (subscription) {
      var selector = JSON.stringify(subscription['graphSelector'])
      subCallbacks.forEach(function (callbacks) {
        if (JSON.stringify(callbacks['graphSelector']) === selector) {
          if (subscription['result'] === 'success') {
            callbacks['success'].forEach(function (callback) {
              callback.call(undefined, subscription['data'])
            })
          } else if (subscription['result'] === 'error') {
            callbacks['error'].forEach(function (callback) {
              errlog(new Error("Subscribe " + selector + " received error: " + data['data']));
              callback.call(undefined, subscription['data'])
            })
          } else {
            errlog(new Error("Subscribe " + selector + " received unknown result: " + subscription['result']));
          }
        }
      })
    })
  }

  // Incoming message object format:
  // { 
  //  get: [
  //        {
  //          graphSelector: {GraphSelectorObject}
  //          result: 'success' || 'error'
  //          data: graphData || errorMessage
  //        },
  //      ] || undefined
  //  subscription: [
  //        {
  //          graphSelector: {GraphSelectorObject}
  //          result: 'success' || 'error'
  //          data: graphData || errorMessage
  //        },
  //      ] || undefined
  // }

  // Handles incoming messages from the server.
  // If the formatting is correct, dispatches any received data or errors to the callbacks
  function parseMessage(message) {
    // console.log("Received: " + message)
    var messageObject = JSON.parse(message);

    if (messageObject['get'] !== undefined) {
      dispatchGet(messageObject['get'])
    }
    if (messageObject['subscription'] !== undefined) {
      dispatchSubscription(messageObject['subscription'])
    }
    if (messageObject['get'] === undefined && messageObject['subscription'] === undefined) {
      errlog(new Error ("Received incorrectly formatted message"))
    }
  }

  // Attempts to submit all the deferred messages, removing those succesfully submitted from the queue.
  function handleDeferreds() {
    if (connected()) {
      deferreds.filter(function (submit) {
        return submit();
      })
    }
  }

  // Registers the provided callbacks to the callbackStore.
  // If the given graphSelector had no callbacks attached, tries to call the submitMethod to send a message to the server.
  function registerCallbacks(callbackStore, graphSelector, successCallback, errorCallback, submitMethod) {
    var unknown_graph;
    var selector = JSON.stringify(graphSelector);

    // First, check if callbacks are already attached to this graphSelector. 
    // If so, simply add the new callbacks.
    unknown_graph = callbackStore.every(function (callbacks) {
      // TODO: Make a more robust comparison method
      if (JSON.stringify(callbacks['graphSelector']) === selector) {
        callbacks['success'].push(successCallback);
        callbacks['error'].push(errorCallback);
        return false;
      } else {
        return true;
      }
    })

    // If this graphSelector is not found in the callbackStore, add it.
    // Also submit a subscription message to the server, or defer this message if sockline is not connected yet.
    if (unknown_graph) {
      callbackStore.push({'graphSelector':graphSelector, 'success':[successCallback], 'error':[errorCallback]})
      if (submitMethod && submitMethod()) {
        log("trying to send messages while not connected - deferring");
        deferreds.push(submitMethod)
      }
    }
  }

  // Unsubscribe from receiving updates for the selected graph.
  // This is only called from a subscription object, returned by the subscribe method.
  function unsubscribe(graphSelector, successCallback, errorCallback) {
    var selector = JSON.stringify(graphSelector)
    // Lambda that submits the unsubscription to the server. Returns false when done, true otherwise.
    var submitUnsubscription = function () {
      if (connected()) {
        sock.send(JSON.stringify({'unsubscribe': [graphSelector]}));
        return false;
      } else {
        return true;
      }
    }

    // Remove callbacks
    subCallbacks.every(function (callbacks, index) {
      // TODO: Make a more robust comparison method
      if (JSON.stringify(callbacks['graphSelector']) === selector) {
        if (callbacks['success'].indexOf(successCallback) >= 0) {
          callbacks['success'].splice(callbacks['success'].indexOf(successCallback), 1);
        }
        if (callbacks['error'].indexOf(errorCallback) >= 0) {
          callbacks['error'].splice(callbacks['error'].indexOf(errorCallback), 1);
        }
        // If this graph has no remaining callbacks, remove it from the store, and submit an unsubscription to the server.
        if (callbacks['success'].length + callbacks['error'].length === 0) {
          subCallbacks.splice(index, 1);
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

  // Subscribe to updates for the selected graph, and attach callbacks.
  // Subscribe only accepts relative timestamps.
  // This will first submit a get request for the full data range,
  // and subsequently receive any values that change for the indicated range.
  // @graphSelector - The graphselector to subscribe to
  // @successCallback - The function to be called when data is received
  // @errorCallback - The function to be called when an error is received
  sockline.subscribe = function (graphSelector, successCallback, errorCallback) {

    // Lambda that submits a get and subscribe message to the server. Returns false when done, true otherwise.
    var submitSubscription = function () {
      if (connected()) {
        sock.send(JSON.stringify({'subscribe': [graphSelector]}))
        return false;
      } else {
        return true;
      }
    }

    // Add the callbacks to getCallbacks, but do not submit a get message
    registerCallbacks(getCallbacks, graphSelector, successCallback, errorCallback, false)

    // Add the callbacks to subCallbacks, and submit a subscription message if needed.
    registerCallbacks(subCallbacks, graphSelector, successCallback, errorCallback, submitSubscription)

    // ## Return a subscription object 
    // The subscription object implements an 'unsubscribe' method.
    // This method can be used to remove the callbacks for this subscription.
    return {'unsubscribe': (function() { unsubscribe(graphSelector, successCallback, errorCallback); })}
  }

  // Get data for the selected graph, and attach callbacks.
  // Get accepts both absolute and relative timestamps
  // Only fires a single request, and delegates the result to either the successCallback or the errorCallback
  // @graphSelector - The graphselector to get
  // @successCallback - The function to be called when data is received
  // @errorCallback - The function to be called when an error is received
  sockline.get = function (graphSelector, successCallback, errorCallback) {

    // Lambda that submits a get message to the server. Returns false when done, true otherwise.
    var submitGet = function () {
      if (connected()) {
        sock.send(JSON.stringify({'get': [graphSelector]}));
        return false;
      } else {
        return true;
      }
    }

    // Add the callbacks to getCallbacks, but do not submit a get message
    registerCallbacks(getCallbacks, graphSelector, successCallback, errorCallback, submitGet)
  }

  // Function to test things, to be removed.
  sockline.send = function (stuff) {
    if (sock !== undefined) {
      sock.send(stuff);
    }
  }

  sockline.debug = function () {
    console.log(subCallbacks)
    console.log(getCallbacks)
  }

}( window.sockline = window.sockline || {} ));


// To test, run the following snippets in the console:

// var wsUri = "ws://0.0.0.0:3001/sock";
// var succ1 = (function (data) {console.log("Successback1 received: " + JSON.stringify(data))});
// var succ2 = (function (data) {console.log("Successback2 received: " + JSON.stringify(data))});
// var err1 = (function (data) {console.log("Errback1 received: " + JSON.stringify(data))});
// var err2 = (function (data) {console.log("Errback2 received: " + JSON.stringify(data))});
// var graph1 = {name: 'phusion.UnionStation.web1.system.temperature.Core_0', from: '-20min', precision: '15s'};
// var graph2 = {name: 'phusion.UnionStation.web1.system.temperature.Core_1', from: '-20min', precision: '15s'};
// sockline.connect(wsUri);
// var sub1 = sockline.subscribe(graph1, succ1, err1);
// sockline.get(graph2, succ2, err2);
// var sub2 = sockline.subscribe(graph2, succ2, err2);