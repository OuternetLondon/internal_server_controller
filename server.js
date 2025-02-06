/**********************************
 * server.js
 **********************************/
require("dotenv").config();

const io = require("socket.io-client");
const OSC = require("osc");

// ============== CONFIG ==============
const MODE = process.env.MODE || "dev";

// Example dev/test/live environment handling
let MULTICAST_IP = "239.255.255.11";
let MULTICAST_PORT = 8998;
let VENTUZ_UNICAST_IP = "10.32.23.11";
let VENTUZ_UNICAST_PORT = 8998;
//let CLOUD_WS_URL = "ws://10.32.23.41:5000";
let CLOUD_WS_URL = "http://localhost:5056/";

switch (MODE) {
  case "test":
    MULTICAST_PORT = 8999;
    VENTUZ_UNICAST_PORT = 8999;
    CLOUD_WS_URL = "wss://ct-test.outernetglobal.com";
    break;
  case "live":
    MULTICAST_PORT = 9000;
    VENTUZ_UNICAST_PORT = 9001;
    CLOUD_WS_URL = "wss://tetris.outernetglobal.com";
    break;
  // dev is default
}

// ============== LOGGING ==============
const log = (...args) => {
  console.log(new Date().toISOString(), ...args);
};

// ============== OSC SETUP ==============
// We'll create an OSC UDP Port to *send* data via multicast
// using the 'osc' library. (You can also do unicast if needed.)
/*const oscPort = new OSC.UDPPort({
  localAddress: "0.0.0.0",
  localPort: 0, // 0 = auto-assign a random open port for sending
  remoteAddress: MULTICAST_IP,
  remotePort: MULTICAST_PORT,
  // If you want to enable multicast loopback or TTL, you can do so:
  multicastTTL: 2,
});*/

const oscPort = new OSC.UDPPort({
  localAddress: "0.0.0.0", // or "127.0.0.1"
  localPort: 0, // auto-choose a sending port
  remoteAddress: "127.0.0.1", // send unicast to loopback
  remotePort: 8998, // same port Protokol listens on
});

// Open the port
oscPort.open();

oscPort.on("ready", () => {
  log("OSC UDP Port ready for multicast:", MULTICAST_IP, MULTICAST_PORT);
});

// ============== HELPER: SEND OSC MESSAGE ==============
function sendOSC(address, ...args) {
  // Build the OSC message
  const msg = {
    address: address,
    args: args,
  };
  log("Sending OSC:", address, args);

  // Send using the oscPort
  oscPort.send(msg);
}

// ============== WEBSOCKET CLIENT SETUP ==============
log("Connecting to cloud server:", CLOUD_WS_URL);
const socket = io(CLOUD_WS_URL, {
  transports: ["websocket"], // ensure websocket
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 2000,
});

socket.on("connect", () => {
  log("Connected to Cloud WS. Socket ID:", socket.id);
  // Optionally join a room:
  socket.emit("join_remote_bridge", "oscbridge_client");
});

// For debugging disconnection
socket.on("disconnect", (reason) => {
  log("Disconnected from Cloud WS:", reason);
});

socket.on("connect_error", (err) => {
  log("Connect error:", err.message);
});

// ============== HANDLE INCOMING CONTROLLER EVENTS ==============
//
// You can either handle them individually by event name,
// or use a single event with a 'type' or 'controlType' field in the data.
//
// Below, we'll assume the server emits something like "controller_data"
// whenever a new JSON packet arrives.

socket.on("controller_data", (jsonData) => {
  // Example jsonData:
  // {
  //   userId: '2ede7765-2adb-4918-9b15-59da406b07b6',
  //   timestamp: '2025-02-06T10:27:04.714Z',
  //   name: 'steeringWheel1',
  //   controlType: 'steeringWheel',
  //   action: 'orientation',
  //   data: { 'orientation-gama': 0, 'orientation-beta': 0 }
  // }

  log("Received controller_data from cloud:", jsonData);

  // 1) Build a shorter OSC address, e.g. /controller/<controlType>
  //    e.g. /controller/steeringWheel
  const address = `/controller/${jsonData.controlType}`;

  // 2) Convert the "data" field into a string if needed
  let dataString = "";
  if (typeof jsonData.data === "object") {
    dataString = JSON.stringify(jsonData.data);
  } else if (jsonData.data !== null && jsonData.data !== undefined) {
    dataString = String(jsonData.data);
  } else {
    dataString = "null";
  }

  // 3) Prepare arguments: We'll pass [userId, timestamp, name, action, dataString]
  //    so we end up with 5 arguments plus the address above => 6 total data pieces
  const args = [
    jsonData.userId,
    jsonData.timestamp,
    jsonData.name,
    jsonData.action,
    dataString,
  ];

  // 4) Send it via our sendOSC helper
  //    This yields something like:
  //    address:  /controller/steeringWheel
  //    args:     [ "2ede7765", "2025-02-06T10:27...", "steeringWheel1", "orientation", "{...}" ]
  sendOSC(address, ...args);

  // (Optional) Acknowledge back to the cloud server
  socket.emit("controller_data_ack", {
    status: "ok",
    receivedAt: new Date().toISOString(),
    originalData: jsonData,
  });
});

// ============== OPTIONAL: ANY OTHER EVENTS ==============
// If your cloud server sends typed events like "button_action", "joystick_action", etc.,
// you can do something like:

socket.on("button_action", (data) => {
  log("Button Action Data:", data);
  // parse & build OSC
  const address = `/controller/${data.name}/${data.action}`;
  sendOSC(address, data.userId || "", data.timestamp || "");
  // etc.
});

// ... repeat for "toggle_action", "joystick_action", etc. ...

// ============== RUNNING THE APP ==============
log("Internal Node OSC Bridge started in", MODE, "mode.");
