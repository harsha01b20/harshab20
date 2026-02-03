# Mars Rover Command Center

A production-ready, full-stack web application to control a Mars-rover-style robot over local WiFi. The stack includes a React frontend, a Node.js backend relay, and an ESP (ESP32/ESP8266) bridge to an Arduino motor controller.

## System Architecture

```
Browser (React)
  └── WebSocket + HTTP
      └── Node.js Relay (Express + Socket.IO)
          └── HTTP + WebSocket (Local WiFi)
              └── ESP32/ESP8266 (Serial → Arduino)
```

### Command Flow
1. User issues command (button, joystick, keyboard, or chat input).
2. Node.js backend receives `/command`, `/mode`, or `/stop`.
3. Backend relays to ESP REST endpoints: `/move`, `/mode`, `/stop`.
4. ESP forwards command over Serial to Arduino.
5. ESP sends telemetry/logs back via WebSocket to backend.
6. Backend broadcasts logs to the browser in real time.

## Features
- **Movement control**: forward/back/left/right, click or press-and-hold.
- **Keyboard control**: W/A/S/D and arrow keys.
- **Virtual joystick**: smooth analog movement updates over WebSocket.
- **Mode control**: manual vs autonomous.
- **Emergency stop**: always visible, immediate motor stop.
- **Live video**: ESP32-CAM feed with graceful disconnect handling.
- **Command chat**: send plain-text commands, view rover responses.
- **Telemetry dashboard**: connection status, current mode, last command, rover logs.
- **Device discovery**: scan local network and connect to a specific ESP by IP.

## Local Setup

### 1) Install dependencies
```
npm install
```

### 2) Configure environment (optional)
You can override defaults with environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `ESP_HTTP_BASE` | `http://192.168.4.1` | ESP REST API base URL |
| `ESP_WS_URL` | `` | ESP telemetry websocket URL (optional) |
| `CAMERA_STREAM_URL` | `http://192.168.4.1:81/stream` | ESP32-CAM MJPEG stream |

### 3) Run the server
```
npm start
```
Open `http://localhost:3000` in a laptop browser.

## Backend API

### `POST /command`
Relays movement/command to ESP.

Request:
```json
{
  "command": "MOVE_FORWARD",
  "speed": 0.7,
  "direction": "N",
  "continuous": true
}
```

### `POST /mode`
Switch manual/autonomous.

Request:
```json
{
  "mode": "MANUAL"
}
```

### `POST /stop`
Emergency stop.

### `GET /config`
Returns frontend config, including camera stream URL.

### `GET /devices`
Returns devices discovered on the local network using ARP.

Response:
```json
{
  "devices": [
    { "ip": "192.168.4.10", "mac": "AA:BB:CC:DD:EE:FF", "raw": "...arp output..." }
  ]
}
```

### `POST /connect`
Sets the active ESP relay target and updates the camera stream URL.

Request:
```json
{
  "espHttpBase": "http://192.168.4.10",
  "cameraStreamUrl": "http://192.168.4.10:81/stream"
}
```

### WebSocket: `/telemetry`
Socket.IO path used by browser and ESP.

Events:
- `telemetry` (ESP → backend → browser):
```json
{
  "type": "rover",
  "message": "Battery 84%",
  "timestamp": "2024-05-16T19:17:03.127Z"
}
```
- `joystick` (browser → backend → ESP):
```json
{
  "angle": 45,
  "speed": 0.6,
  "vector": { "x": 0.7, "y": 0.7 },
  "timestamp": 1715887023127
}
```

## ESP REST API Interface (example)
The backend expects the ESP to expose the following endpoints:

### `POST /move`
```json
{
  "command": "MOVE_FORWARD",
  "speed": 0.8,
  "direction": "N",
  "continuous": true,
  "timestamp": 1715887023127
}
```

### `POST /mode`
```json
{
  "mode": "AUTONOMOUS",
  "command": "MODE_AUTO",
  "timestamp": 1715887023127
}
```

### `POST /stop`
```json
{
  "command": "STOP",
  "timestamp": 1715887023127
}
```

## ESP WebSocket Telemetry (example)
ESP should send telemetry/log messages to the backend Socket.IO `/telemetry` path or to `ESP_WS_URL` if configured.

Payload example:
```json
{
  "type": "rover",
  "message": "Front distance sensor: 42cm",
  "timestamp": "2024-05-16T19:17:03.127Z"
}
```

## Production Notes
- Deploy the Node.js server on the same network as the rover.
- Pin the ESP IP address (static IP or router DHCP reservation).
- Consider TLS termination at the relay for secured command channels.
- Add authentication if the network is shared.
