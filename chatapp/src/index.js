'use strict';

//var os = require('os');
var fs = require('fs');
var nodeStatic = require('node-static');
var https = require('https');
var path = require('path');
var socketIO = require('socket.io');
var ssl = {
  key: fs.readFileSync(path.join(__dirname, '../certificates/server.key')),
  cert: fs.readFileSync(path.join(__dirname, '../certificates/server.cert'))
};
var fileServer = new (nodeStatic.Server)();

var server = https.createServer(ssl, (req, res) => {
  fileServer.serve(req, res);
}).listen(3000);

server.on('listening', onListening);

function onListening() {
  var addr = server.address();
  var bind = typeof addr === 'string' ? 'pipe ' + addr : 'port ' + addr.port;
  console.log('*** Listening on ' + bind);
}

var io = socketIO.listen(server);
io.sockets.on('connection', function (socket) {

  // convenience function to log server messages on the client
  function log() {
    var array = ['Message from server:'];
    array.push.apply(array, arguments);
    console.log.apply(console, array);
  }

  socket.on('message', function (message) {
    log('Receive message: ', message);
    // for a real app, would be room-only (not broadcast)
    if(message.peerId) {
      socket.to(message.peerId).emit('message', {message: message.message, id: socket.id});
    }else {
      socket.broadcast.emit('message', {message: message, id: socket.id});
    }
    if(message.type === 'bye') {
      console.log('received bye');
      io.sockets.in(message.room).clients(function (error, clients) {
        if (clients.length > 0) {
          console.log('clients in the room: \n');
          console.log(clients);
          clients.forEach(function (socket_id) {
            io.sockets.sockets[socket_id].leave(message.room);
          });
        }
      });
    };
  });

  socket.on('create or join', function (room) {
    log('Received request to create or join room ' + room);

    var clientsInRoom = io.sockets.adapter.rooms[room];
    // console.log(io.sockets.adapter.rooms);
    var numClients = clientsInRoom ? Object.keys(clientsInRoom.sockets).length : 0;
    log('Room ' + room + ' now has ' + numClients + ' client(s)');

    if (numClients === 0) {
      socket.join(room);
      log('Client ID ' + socket.id + ' created room ' + room);
      socket.emit('created', room, socket.id);

    } else if (numClients > 0) {
      log('Client ID ' + socket.id + ' joined room ' + room);
      io.sockets.in(room).emit('join', { room: room, id: socket.id });
      socket.join(room);
      // console.log(io.sockets.adapter.rooms);
      socket.emit('joined', room, socket.id);
      io.sockets.in(room).emit('ready');
    }
    // } else { // max two clients
    //   socket.emit('full', room);
    // }
  });

  socket.on('ipaddr', function () {
    var ifaces = os.networkInterfaces();
    for (var dev in ifaces) {
      ifaces[dev].forEach(function (details) {
        if (details.family === 'IPv4' && details.address !== '127.0.0.1') {
          socket.emit('ipaddr', details.address);
        }
      });
    }
  });

});

// Message Type:
// - message
// - create or join
// - ipaddr
// - bye

// Emit Type:
// - log
// - message (broadcast) => message cho tat ca client tru send
// - created (=> id) thong bao cho client truc tiep
// - join (=> in room) thong bao ca room including sender
// - joined (=> id) thong bao cho client truc tiep
// - ready (=> in room) thong bao cho ca room including sender
// - full
// - ipaddr
