const express = require("express");
const http = require("http");
const path = require("path");
const { exec } = require("child_process");
const { Server } = require("socket.io");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  path: "/telemetry",
  cors: { origin: "*" },
});

const PORT = process.env.PORT || 3000;
let espHttpBase = process.env.ESP_HTTP_BASE || "http://192.168.4.1";
const ESP_WS_URL = process.env.ESP_WS_URL || "";
const DEFAULT_CAMERA_STREAM_URL =
  process.env.CAMERA_STREAM_URL || "http://192.168.4.1:81/stream";
let cameraStreamUrl = DEFAULT_CAMERA_STREAM_URL;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

let lastCommand = "None";

const sendToEsp = async (endpoint, payload) => {
  const url = `${espHttpBase}${endpoint}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`ESP responded with ${response.status}: ${text}`);
  }

  return response.json().catch(() => ({}));
};

app.get("/config", (req, res) => {
  res.json({
    cameraStreamUrl,
    espHttpBase,
  });
});

const parseArpOutput = (stdout) => {
  const lines = stdout.split("\n");
  const devices = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const ipMatch = trimmed.match(/\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b/);
    const macMatch = trimmed.match(/([0-9a-f]{2}[:-]){5}[0-9a-f]{2}/i);
    if (!ipMatch) continue;
    devices.push({
      ip: ipMatch[0],
      mac: macMatch ? macMatch[0] : null,
      raw: trimmed,
    });
  }
  return devices;
};

const listNetworkDevices = () =>
  new Promise((resolve, reject) => {
    exec("arp -a", { timeout: 4000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }
      resolve(parseArpOutput(stdout));
    });
  });

app.get("/devices", async (req, res) => {
  try {
    const devices = await listNetworkDevices();
    res.json({ devices });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/connect", (req, res) => {
  const { espHttpBase: nextBase, cameraStreamUrl: nextCamera } = req.body;
  if (!nextBase) {
    return res.status(400).json({ error: "espHttpBase is required" });
  }

  espHttpBase = nextBase;
  if (nextCamera) {
    cameraStreamUrl = nextCamera;
  } else {
    cameraStreamUrl = `${nextBase}:81/stream`;
  }

  io.emit("telemetry", {
    type: "system",
    message: `Relay connected to ${espHttpBase}`,
    timestamp: new Date().toISOString(),
  });

  return res.json({ success: true, espHttpBase, cameraStreamUrl });
});

app.post("/command", async (req, res) => {
  const { command, speed, direction, continuous } = req.body;
  if (!command) {
    return res.status(400).json({ error: "command is required" });
  }

  lastCommand = command;

  try {
    const payload = {
      command,
      speed,
      direction,
      continuous: Boolean(continuous),
      timestamp: Date.now(),
    };
    await sendToEsp("/move", payload);
    io.emit("telemetry", {
      type: "system",
      message: `Backend relayed ${command} to ESP`,
      timestamp: new Date().toISOString(),
    });
    return res.json({ success: true });
  } catch (error) {
    io.emit("telemetry", {
      type: "system",
      message: `Failed to relay ${command}: ${error.message}`,
      timestamp: new Date().toISOString(),
    });
    return res.status(502).json({ error: error.message });
  }
});

app.post("/mode", async (req, res) => {
  const { mode } = req.body;
  if (!mode) {
    return res.status(400).json({ error: "mode is required" });
  }

  const command = mode === "AUTONOMOUS" ? "MODE_AUTO" : "MODE_MANUAL";
  lastCommand = command;

  try {
    await sendToEsp("/mode", { mode, command, timestamp: Date.now() });
    io.emit("telemetry", {
      type: "system",
      message: `Mode set to ${mode}`,
      timestamp: new Date().toISOString(),
    });
    return res.json({ success: true });
  } catch (error) {
    return res.status(502).json({ error: error.message });
  }
});

app.post("/stop", async (req, res) => {
  lastCommand = "STOP";
  try {
    await sendToEsp("/stop", { command: "STOP", timestamp: Date.now() });
    io.emit("telemetry", {
      type: "system",
      message: "Emergency stop relayed to ESP",
      timestamp: new Date().toISOString(),
    });
    return res.json({ success: true });
  } catch (error) {
    return res.status(502).json({ error: error.message });
  }
});

app.get("/status", (req, res) => {
  res.json({
    status: "online",
    lastCommand,
    espHttpBase,
  });
});

io.on("connection", (socket) => {
  io.emit("telemetry", {
    type: "system",
    message: "Client connected to telemetry channel.",
    timestamp: new Date().toISOString(),
  });

  socket.on("joystick", async (payload) => {
    try {
      await sendToEsp("/move", {
        command: "JOYSTICK",
        ...payload,
        timestamp: Date.now(),
      });
    } catch (error) {
      io.emit("telemetry", {
        type: "system",
        message: `Joystick relay failed: ${error.message}`,
        timestamp: new Date().toISOString(),
      });
    }
  });

  socket.on("telemetry", (payload) => {
    io.emit("telemetry", payload);
  });
});

if (ESP_WS_URL) {
  const espSocket = new WebSocket(ESP_WS_URL);

  espSocket.on("open", () => {
    io.emit("telemetry", {
      type: "system",
      message: "Connected to ESP telemetry websocket.",
      timestamp: new Date().toISOString(),
    });
  });

  espSocket.on("message", (data) => {
    try {
      const payload = JSON.parse(data.toString());
      io.emit("telemetry", payload);
    } catch (error) {
      io.emit("telemetry", {
        type: "system",
        message: `Malformed ESP telemetry: ${data.toString()}`,
        timestamp: new Date().toISOString(),
      });
    }
  });

  espSocket.on("close", () => {
    io.emit("telemetry", {
      type: "system",
      message: "ESP telemetry websocket closed.",
      timestamp: new Date().toISOString(),
    });
  });

  espSocket.on("error", (error) => {
    io.emit("telemetry", {
      type: "system",
      message: `ESP websocket error: ${error.message}`,
      timestamp: new Date().toISOString(),
    });
  });
}

server.listen(PORT, () => {
  console.log(`Rover control server running at http://localhost:${PORT}`);
});
