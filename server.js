const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  path: "/telemetry",
  cors: { origin: "*" },
});

const PORT = process.env.PORT || 3000;
const ESP_HTTP_BASE = process.env.ESP_HTTP_BASE || "http://192.168.4.1";
const ESP_WS_URL = process.env.ESP_WS_URL || "";
const CAMERA_STREAM_URL =
  process.env.CAMERA_STREAM_URL || "http://192.168.4.1:81/stream";

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

let lastCommand = "None";

const sendToEsp = async (endpoint, payload) => {
  const url = `${ESP_HTTP_BASE}${endpoint}`;
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
    cameraStreamUrl: CAMERA_STREAM_URL,
    espHttpBase: ESP_HTTP_BASE,
  });
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
    espHttpBase: ESP_HTTP_BASE,
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
