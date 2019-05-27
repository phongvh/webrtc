'use strict';

var isChannelReady = false;
var isInitiator = false;
var isStarted = false;
var localStream;
var remoteStream;

// var sendChannel;
// var receiveChannel;
var socket;

var peers = {};

var pcConfig = {
  'iceServers': [{"url":"stun:stun.l.google.com:19302"},{"url":"turn:turn-uswest.ohmnilabs.com:5349?transport=udp","username":"turn-ramen","credential":"H7D0AArXju9d"},{"url":"turn:turn-uswest.ohmnilabs.com:5349?transport=tcp","username":"turn-ramen","credential":"H7D0AArXju9d"},{"url":"turn:turn-useast.ohmnilabs.com:5349?transport=udp","username":"turn-ramen","credential":"H7D0AArXju9d"},{"url":"turn:turn-useast.ohmnilabs.com:5349?transport=tcp","username":"turn-ramen","credential":"H7D0AArXju9d"},{"url":"turn:turn-tokyo.ohmnilabs.com:5349?transport=udp","username":"turn-ramen","credential":"H7D0AArXju9d"},{"url":"turn:turn-tokyo.ohmnilabs.com:5349?transport=tcp","username":"turn-ramen","credential":"H7D0AArXju9d"},{"url":"turn:turn-sydney.ohmnilabs.com:5349?transport=udp","username":"turn-ramen","credential":"H7D0AArXju9d"},{"url":"turn:turn-sydney.ohmnilabs.com:5349?transport=tcp","username":"turn-ramen","credential":"H7D0AArXju9d"},{"url":"turn:turn-frankfurt.ohmnilabs.com:5349?transport=udp","username":"turn-ramen","credential":"H7D0AArXju9d"},{"url":"turn:turn-frankfurt.ohmnilabs.com:5349?transport=tcp","username":"turn-ramen","credential":"H7D0AArXju9d"}]
};

// Set up audio and video regardless of what devices are present.
// var sdpConstraints = {
//   offerToReceiveAudio: true,
//   offerToReceiveVideo: true
// };

// On this codelab, you will be streaming only video (video: true).
const mediaStreamConstraints = {
  video: {
    width: 1280,
    height: 720
  },
  audio: false
};

// Video element where stream will be placed.
var localVideo = document.querySelector('#local-video');
var remoteVideo = document.querySelector('.selected-video');

var dataChannelSend = document.querySelector('textarea#dataChannelSend');
var dataChannelReceive = document.querySelector('.chat-content');

var hangupButton = document.querySelector('button.hangup-btn');
var sendButton = document.querySelector('button#sendButton');

/////////////////////////////////////////////

var welcomeScreen = document.querySelector('.welcome-screen');
var enterRoomButton = document.querySelector('button#enter-room');
var roomInput = document.querySelector('input#room');
var nameInput = document.querySelector('input#name');

var videoList = document.querySelector('.video-list');

var room = 'Ohmnilabs';
var name = 'Anonymous';

nameInput.focus();
nameInput.addEventListener("keypress", function (event) {
  // console.log("keypress", event.keyCode);
  if (event.keyCode === 13) {
    initializeRoom();
  }
});

enterRoomButton.onclick = initializeRoom;

function initializeRoom() {
  room = roomInput.value;
  name = nameInput.value;
  runApp();
  welcomeScreen.style.display = "none";
}

function runApp() {

  hangupButton.onclick = hangup;
  sendButton.onclick = sendData;

  // Initializes media stream.
  navigator.mediaDevices.getUserMedia(mediaStreamConstraints)
    .then(gotLocalMediaStream).catch(handleLocalMediaStreamError);

  dataChannelSend.addEventListener("keypress", function (event) {
    // console.log("keypress", event.keyCode);
    if (event.keyCode === 13) {
      sendData();
    }
  });

  window.onbeforeunload = function () {
    sendMessage('hangup');
  };

  socket = io.connect();

  if (room !== '') {
    socket.emit('create or join', room);
    console.log('Attempted to create or  join room', room);
  }

  socket.on('created', function (room, id) {
    console.log('Created room ' + room + ' ' + id);
    setStatus('Waiting for people to join...')
    isInitiator = true;
  });

  socket.on('full', function (room) {
    console.log('Room ' + room + ' is full');
  });

  socket.on('join', function (msg) {
    console.log('Another peer with id=' + msg.id + ' made a request to join room ' + msg.room);
    console.log('This peer is the initiator of room ' + msg.room + '!');
    setStatus('Someone is joining...');
    isInitiator = true;
    isChannelReady = true;
    peers[msg.id] = {pc: null, sendChannel: null, receiveChannel: null}
  });

  socket.on('joined', function (room) {
    console.log('joined: ' + room);
    isChannelReady = true;
  });

  // This client receives a message
  socket.on('message', function (msg) {
    var message = msg.message;
    console.log('Client received message:', msg);
    if (message === 'got user media') {
      maybeStart(msg.id);
    } else if (message === 'hangup'){
      peers[msg.id] = null;
      var ele = document.getElementById('stream-'+msg.id);
      ele.parentNode.removeChild(ele);
    } else if (message.type === 'offer') {
      console.log('Process offer');
      if (!isInitiator) {
        peers[msg.id] = {pc: null, sendChannel: null, receiveChannel: null}
        maybeStart(msg.id);
      }
      peers[msg.id].pc.setRemoteDescription(new RTCSessionDescription(message));
      peers[msg.id].pc.ondatachannel = function (event) {
        console.log('Receive Channel Callback');
        var receiveChannel = event.channel;
        receiveChannel.onmessage = onReceiveMessageCallback;
        receiveChannel.onopen = onReceiveChannelStateChange;
        receiveChannel.onclose = onReceiveChannelStateChange;
        peers[msg.id].receiveChannel = receiveChannel;
      };
      doAnswer(msg.id);
      setStatus('Call started');
      document.querySelector('.hangup-btn').disabled = false;
    } else if (message.type === 'answer' && isStarted) {
      console.log('Process answer');
      peers[msg.id].pc.setRemoteDescription(new RTCSessionDescription(message));
      peers[msg.id].pc.ondatachannel = function (event) {
        console.log('Receive Channel Callback');
        var receiveChannel = event.channel;
        receiveChannel.onmessage = onReceiveMessageCallback;
        receiveChannel.onopen = onReceiveChannelStateChange;
        receiveChannel.onclose = onReceiveChannelStateChange;
        peers[msg.id].receiveChannel = receiveChannel;
      };
      setStatus('Call started');
      document.querySelector('.hangup-btn').disabled = false;
    } else if (message.type === 'candidate' && isStarted) {
      console.log('Process candidate');
      var candidate = new RTCIceCandidate({
        sdpMLineIndex: message.label,
        candidate: message.candidate
      });
      peers[msg.id].pc.addIceCandidate(candidate);
    } else if (message.type === 'bye' && isStarted) {
      handleRemoteHangup();
    }
  });
}

// Handles success by adding the MediaStream to the video element.
function gotLocalMediaStream(mediaStream) {
  localStream = mediaStream;
  localVideo.srcObject = mediaStream;
  localVideo.onclick = function () {
    //localVideo.className = "selected-video";
    //remoteVideo.parentNode.replaceChild(localVideo, remoteVideo);
    remoteVideo.srcObject = localVideo.srcObject;
  }
  sendMessage('got user media');
  if (isInitiator) {
    maybeStart();
  }
}

// Handles error by logging a message to the console with the error message.
function handleLocalMediaStreamError(error) {
  console.log('navigator.getUserMedia error: ', error);
}

function maybeStart(id) {
  console.log('>>>>>>> maybeStart() ', isStarted, localStream, isChannelReady);
  if (typeof localStream !== 'undefined' && isChannelReady) {
    console.log('>>>>>> creating peer connection');
    createPeerConnection(id);
    peers[id].pc.addStream(localStream);
    isStarted = true;
    console.log('isInitiator', isInitiator);
    if (isInitiator) {
      doCall(id);
    }
  }
}

/////////////////////////////////////////////////////////

function createPeerConnection(id) {
  try {
    var pc = new RTCPeerConnection(pcConfig);
    pc.onicecandidate = handleIceCandidate;
    pc.onaddstream = function (event) {
      // remoteVideo.id = 'stream-'+id;
      remoteStream = event.stream;
      // if(!remoteVideo.srcObject){
        console.log('Remote stream added.');
        remoteVideo.srcObject = remoteStream;
      //}else{
        var video = document.createElement('video');
        video.id = 'stream-'+id;
        video.autoplay = true;
        video.className = "local-video";
        video.srcObject = remoteStream;
        video.onclick = function () {
          //video.className = "selected-video";
          //remoteVideo.parentNode.replaceChild(video, remoteVideo);
          remoteVideo.srcObject = video.srcObject;
        }
        videoList.appendChild(video);
      // }
    };
    pc.onremovestream = handleRemoteStreamRemoved;
    console.log('Created RTCPeerConnnection');
    var sendChannel = pc.createDataChannel('sendDataChannel');
    console.log('Created send data channel');

    sendChannel.onopen = onSendChannelStateChange;
    sendChannel.onmessage = onReceiveMessageCallback;
    sendChannel.onclose = onSendChannelStateChange;
    peers[id].pc = pc,
    peers[id].sendChannel = sendChannel;
  } catch (e) {
    console.log('Failed to create PeerConnection, exception: ' + e.message);
    alert('Cannot create RTCPeerConnection object.');
    return;
  }
}

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

// function handleRemoteStreamAdded(event) {
//   console.log(event);
//   remoteStream = event.stream;
//   if(!remoteVideo.srcObject){
//     console.log('Remote stream added.');
//     remoteVideo.srcObject = remoteStream;
//   }else{
//     var video = document.createElement('video');
//     video.autoplay = true;
//     video.className = "local-video";
//     video.srcObject = remoteStream;
//     videoList.appendChild(video);
//   }
// }

function handleRemoteStreamRemoved(event) {
  console.log('Remote stream removed. Event: ', event);
}

function doCall(id) {
  console.log('Sending offer to peer');
  peers[id].pc.createOffer(
    function (sessionDescription) {
      peers[id].pc.setLocalDescription(sessionDescription);
      console.log('setLocalAndSendMessage sending message', sessionDescription);
      sendMessage({message: sessionDescription, peerId: id});
    }, handleCreateOfferError);
}

// function setLocalAndSendMessage(sessionDescription) {
//   peers[joiningPeer].pc.setLocalDescription(sessionDescription);
//   console.log('setLocalAndSendMessage sending message', sessionDescription);
//   sendMessage({message: sessionDescription, peerId: joiningPeer});
// }

function onCreateSessionDescriptionError(error) {
  console.log('Failed to create session description: ' + error.toString());
}

function handleCreateOfferError(event) {
  console.log('createOffer() error: ', event);
}

function doAnswer(id) {
  console.log('Sending answer to peer.');
  peers[id].pc.createAnswer().then(
    function (sessionDescription) {
      peers[id].pc.setLocalDescription(sessionDescription);
      console.log('setLocalAndSendMessage sending message', sessionDescription);
      sendMessage({message: sessionDescription, peerId: id});
    },
    onCreateSessionDescriptionError
  );
}

function hangup() {
  console.log('Hanging up.');
  stop();
  sendMessage('hangup');
}

function handleRemoteHangup() {
  console.log('Session terminated.');
  stop();
  isInitiator = false;
  document.querySelector('.hangup-btn').disabled = true;
}

function stop() {
  isStarted = false;
  var peer;
  for(peer in peers){
    peers[peer].pc.close();
  }
  document.querySelector('.hangup-btn').disabled = true;
  setStatus('Call ended');
}

function onSendChannelStateChange() {
  //var readyState = sendChannel.readyState;
  //console.log('Send channel state is: ' + readyState);
  // if (readyState === 'open') {
  //   dataChannelSend.disabled = false;
  //   dataChannelSend.focus();
  //   sendButton.disabled = false;
  // } else {
  //   dataChannelSend.disabled = true;
  //   sendButton.disabled = true;
  // }
}

function sendData() {
  var data = dataChannelSend.value;
  var msg = {
    name: name,
    message: data
  };
  var peer;
  for(peer in peers){
    peers[peer].sendChannel.send(JSON.stringify(msg));
  }

  addChatMessage(msg);
  dataChannelSend.value = '';
  dataChannelSend.focus();
  console.log('Sent Data: ' + JSON.stringify(msg));
}

// function receiveChannelCallback(event) {
//   console.log('Receive Channel Callback');
//   var receiveChannel = event.channel;
//   receiveChannel.onmessage = onReceiveMessageCallback;
//   receiveChannel.onopen = onReceiveChannelStateChange;
//   receiveChannel.onclose = onReceiveChannelStateChange;
//   peers[joiningPeer].receiveChannel = receiveChannel;
// }

function onReceiveMessageCallback(event) {
  console.log('Received Message ' + event.data);
  var msg = JSON.parse(event.data);
  addChatMessage(msg);
}

function onReceiveChannelStateChange() {
  // var readyState = pc.readyState;
  // console.log('Receive channel state is: ' + readyState);
}

function addChatMessage(data) {
  var message = document.createElement('div');
  message.className = 'container';
  var t = document.createTextNode(data.name + ': ' + data.message);
  message.appendChild(t);
  dataChannelReceive.appendChild(message);
}

function sendMessage(message) {
  console.log('Client sending message: ', message);
  socket.emit('message', { message: message, room: room});
}

function setStatus(status) {
  document.querySelector('.status-message').innerText = status;
}