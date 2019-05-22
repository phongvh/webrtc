'use strict';

var isChannelReady = false;
var isInitiator = false;
var isStarted = false;

var pc;
var sendChannel;
var receiveChannel;
var pcConstraint;
var dataConstraint;
var dataChannelSend = document.querySelector('textarea#dataChannelSend');
var dataChannelReceive = document.querySelector('.chat-content');

var hangupButton = document.querySelector('button.hangup-btn');
var sendButton = document.querySelector('button#sendButton');

var room = 'foo';
var name = 'Anonymous';
// Could prompt for room name:
name = prompt('Enter your name:');

var setStatus = function (status) {
  document.querySelector('.status-message').innerText = status;
}

var socket = io.connect();

if (room !== '') {
  socket.emit('create or join', room);
  console.log('Attempted to create or  join room', room);
}

socket.on('created', function (room) {
  console.log('Created room ' + room);
  setStatus('Waiting for people to join...')
  isInitiator = true;
});

socket.on('full', function (room) {
  console.log('Room ' + room + ' is full');
});

socket.on('join', function (room) {
  console.log('Another peer made a request to join room ' + room);
  console.log('This peer is the initiator of room ' + room + '!');
  setStatus('Someone is joining...');
  isChannelReady = true;
});

socket.on('joined', function (room) {
  console.log('joined: ' + room);
  isChannelReady = true;
});

///////////////////////////////////////////////

function sendMessage(message) {
  console.log('Client sending message: ', message);
  socket.emit('message', message);
}


// This client receives a message
socket.on('message', function (message) {
  console.log('Client received message:', message);
  if (message === 'got user media') {
    createConnection();
  } else if (message.type === 'offer') {
    console.log('Process offer');
    if (!isInitiator && !isStarted) {
      createConnection();
    }
    pc.setRemoteDescription(new RTCSessionDescription(message));
    pc.ondatachannel = receiveChannelCallback;
    //doAnswer();
    pc.createAnswer().then(
      setLocalAndSendMessage,
      onCreateSessionDescriptionError
    );
    setStatus('Call started');
    document.querySelector('.hangup-btn').disabled = false;
  } else if (message.type === 'answer' && isStarted) {
    console.log('Process answer');
    pc.setRemoteDescription(new RTCSessionDescription(message));
    pc.ondatachannel = receiveChannelCallback;
    setStatus('Call started');
    document.querySelector('.hangup-btn').disabled = false;
  } else if (message.type === 'candidate' && isStarted) {
    console.log('Process candidate');
    var candidate = new RTCIceCandidate({
      sdpMLineIndex: message.label,
      candidate: message.candidate
    });
    pc.addIceCandidate(candidate);
  } else if (message.type === 'bye' && isStarted) {
    handleRemoteHangup();
  }
});

function onCreateSessionDescriptionError(error) {
  trace('Failed to create session description: ' + error.toString());
}

// startButton.onclick = createConnection;
sendMessage('got user media');
if (isInitiator) {
  createConnection();
}

hangupButton.onclick=hangup;
sendButton.onclick = sendData;

dataChannelSend.addEventListener("keypress", function(event) {
  console.log("keypress", event.keyCode);
  if (event.keyCode === 13) {
      sendData();
  }
})
// closeButton.onclick = closeDataChannels;

// function enableStartButton() {
//   startButton.disabled = false;
// }

function disableSendButton() {
  sendButton.disabled = true;
}

function createConnection() {
  if (!isStarted && isChannelReady) {
    dataChannelSend.placeholder = '';
    var servers = {
      'iceServers': [{
        'urls': 'stun:stun.l.google.com:19302'
      }]
    };
    pcConstraint = null;
    dataConstraint = null;
    trace('Using SCTP based data channels');
    // For SCTP, reliable and ordered delivery is true by default.
    // Add localConnection to global scope to make it visible
    // from the browser console.
    pc = new RTCPeerConnection(servers, pcConstraint);
    trace('Created local peer connection object localConnection');

    sendChannel = pc.createDataChannel('sendDataChannel',
      dataConstraint);
    trace('Created send data channel');

    pc.onicecandidate = handleIceCandidate;

    sendChannel.onopen = onSendChannelStateChange;
    sendChannel.onmessage = onReceiveMessageCallback;
    sendChannel.onclose = onSendChannelStateChange;

    isStarted = true;
    if (isInitiator) {
      pc.createOffer().then(
        setLocalAndSendMessage,
        handleCreateOfferError
      );
    }
  }
}

function onSendChannelStateChange() {
  var readyState = sendChannel.readyState;
  trace('Send channel state is: ' + readyState);
  if (readyState === 'open') {
    dataChannelSend.disabled = false;
    dataChannelSend.focus();
    sendButton.disabled = false;
  } else {
    dataChannelSend.disabled = true;
    sendButton.disabled = true;
  }
}

function setLocalAndSendMessage(sessionDescription) {
  pc.setLocalDescription(sessionDescription);
  console.log('setLocalAndSendMessage sending message', sessionDescription);
  sendMessage(sessionDescription);
}

function handleCreateOfferError(event) {
  console.log('createOffer() error: ', event);
}

function sendData() {
  var data = dataChannelSend.value;
  var msg = {
    name: name,
    message: data
  };
  sendChannel.send(JSON.stringify(msg));
  addChatMessage(msg);
  dataChannelSend.value = '';
  dataChannelSend.focus();
  trace('Sent Data: ' + data);
}

// window.onbeforeunload = function () {
//   sendMessage({type: 'bye', room: room});
// };

/////////////////////////////////////////////////////////


function handleIceCandidate(event) {
  console.log('icecandidate event: ', event);
  if (event.candidate) {
    sendMessage({
      type: 'candidate',
      label: event.candidate.sdpMLineIndex,
      id: event.candidate.sdpMid,
      candidate: event.candidate.candidate
    });
  } else {
    console.log('End of candidates.');
  }
}

function receiveChannelCallback(event) {
  trace('Receive Channel Callback');
  receiveChannel = event.channel;
  receiveChannel.onmessage = onReceiveMessageCallback;
  receiveChannel.onopen = onReceiveChannelStateChange;
  receiveChannel.onclose = onReceiveChannelStateChange;
}

function onReceiveMessageCallback(event) {
  trace('Received Message ' + event.data);
  var data = JSON.parse(event.data);
  addChatMessage(data);
}

function onReceiveChannelStateChange() {
  var readyState = receiveChannel.readyState;
  trace('Receive channel state is: ' + readyState);
}

function trace(text) {
  if (text[text.length - 1] === '\n') {
    text = text.substring(0, text.length - 1);
  }
  if (window.performance) {
    var now = (window.performance.now() / 1000).toFixed(3);
    console.log(now + ': ' + text);
  } else {
    console.log(text);
  }
}

function hangup() {
  console.log('Hanging up.');
  stop();
  sendMessage({type: 'bye', room: room});
}

function handleRemoteHangup() {
  console.log('Session terminated.');
  stop();
  isInitiator = false;
  document.querySelector('.hangup-btn').disabled = true;
}

function stop() {
  isStarted = false;
  pc.close();
  pc = null;
  document.querySelector('.hangup-btn').disabled = true;
  setStatus('Call ended');
}

function addChatMessage(data) {
  var message = document.createElement('div');
  message.className = 'container';
  var t = document.createTextNode(data.name + ': ' + data.message);
  message.appendChild(t);
  dataChannelReceive.appendChild(message);
}