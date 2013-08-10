sockline
========

A javascript library for retrieving graph data over websockets


Status
------

Sockline is a work in progress. The basic framework is in place to allow you to subscribe to graphing data, and dispatch it to callbacks. 
The API is not finalized, and functions exposed to the user will change in the near future.


Current Features
----------------

- Subscribe to graph information over a websocket
- Accept graph data and errors, and dispatch callbacks for this graph


Planned Features
----------------

- Better graph subscriptions. The user should be able to indicate the desired response type when requested detail level is not available on the server.
- Create a configuration function. This function should accept connection configurations and global graph defaults.
- HTTP Auth
- Full API Documentation in this README
- Unit Testing


Current issues
--------------

- It is currently not possible to unsubscribe from graphs
- Comparison of graphSelectors is not sufficient and needs a more robust implementation
- Some code needs cleanup


Attribution
-----------

Sockline is owned by [Phusion](https://github.com/phusion)
