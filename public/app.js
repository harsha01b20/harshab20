const { useEffect, useMemo, useRef, useState } = React;

const COMMANDS = {
  forward: "MOVE_FORWARD",
  backward: "MOVE_BACKWARD",
  left: "TURN_LEFT",
  right: "TURN_RIGHT",
  stop: "STOP",
};

function useInterval(callback, delay) {
  const savedCallback = useRef();

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (delay === null) return;
    const id = setInterval(() => savedCallback.current(), delay);
    return () => clearInterval(id);
  }, [delay]);
}

function Joystick({ onMove, onStop }) {
  const baseRef = useRef(null);
  const stickRef = useRef(null);
  const [active, setActive] = useState(false);
  const rafRef = useRef(null);

  const updateStick = (x, y) => {
    if (!stickRef.current) return;
    stickRef.current.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
  };

  const handlePointerMove = (event) => {
    if (!active || !baseRef.current) return;
    const rect = baseRef.current.getBoundingClientRect();
    const radius = rect.width / 2;
    const centerX = rect.left + radius;
    const centerY = rect.top + radius;
    const dx = event.clientX - centerX;
    const dy = event.clientY - centerY;
    const distance = Math.min(Math.hypot(dx, dy), radius - 10);
    const angle = Math.atan2(dy, dx);
    const x = Math.cos(angle) * distance;
    const y = Math.sin(angle) * distance;

    updateStick(x, y);

    const normalizedSpeed = Math.min(distance / (radius - 10), 1);
    const payload = {
      angle: Math.round((angle * 180) / Math.PI),
      speed: Number(normalizedSpeed.toFixed(2)),
      vector: {
        x: Number((x / (radius - 10)).toFixed(2)),
        y: Number((y / (radius - 10)).toFixed(2)),
      },
      timestamp: Date.now(),
    };

    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        onMove(payload);
      });
    }
  };

  const resetStick = () => {
    setActive(false);
    updateStick(0, 0);
    onStop();
  };

  return (
    <div
      className="joystick-base"
      ref={baseRef}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        setActive(true);
      }}
      onPointerMove={handlePointerMove}
      onPointerUp={resetStick}
      onPointerLeave={resetStick}
    >
      <div className="joystick-stick" ref={stickRef} />
    </div>
  );
}

function App() {
  const [connectionStatus, setConnectionStatus] = useState("disconnected");
  const [mode, setMode] = useState("MANUAL");
  const [lastCommand, setLastCommand] = useState("None");
  const [telemetry, setTelemetry] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [cameraUrl, setCameraUrl] = useState("");
  const [cameraOnline, setCameraOnline] = useState(true);
  const socketRef = useRef(null);
  const movementRef = useRef({ timer: null, current: null });

  useEffect(() => {
    fetch("/config")
      .then((res) => res.json())
      .then((config) => {
        setCameraUrl(config.cameraStreamUrl);
      })
      .catch(() => {
        setCameraUrl("");
      });
  }, []);

  useEffect(() => {
    const socket = io({ path: "/telemetry" });
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnectionStatus("connected");
      pushTelemetry({
        type: "system",
        message: "Command link established with rover relay.",
        timestamp: new Date().toISOString(),
      });
    });

    socket.on("disconnect", () => {
      setConnectionStatus("disconnected");
      pushTelemetry({
        type: "system",
        message: "Lost connection to rover relay.",
        timestamp: new Date().toISOString(),
      });
    });

    socket.on("telemetry", (payload) => {
      pushTelemetry(payload);
    });

    return () => socket.disconnect();
  }, []);

  const pushTelemetry = (payload) => {
    setTelemetry((prev) => [payload, ...prev].slice(0, 50));
  };

  const sendCommand = async (command, meta = {}) => {
    setLastCommand(command);
    try {
      await fetch("/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command, ...meta }),
      });
      pushTelemetry({
        type: "system",
        message: `Command sent: ${command}`,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      pushTelemetry({
        type: "system",
        message: `Command failed: ${error.message}`,
        timestamp: new Date().toISOString(),
      });
    }
  };

  const sendStop = async () => {
    setLastCommand("STOP");
    try {
      await fetch("/stop", { method: "POST" });
      pushTelemetry({
        type: "system",
        message: "Emergency stop engaged.",
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      pushTelemetry({
        type: "system",
        message: `Emergency stop failed: ${error.message}`,
        timestamp: new Date().toISOString(),
      });
    }
  };

  const setModeRemote = async (nextMode) => {
    setMode(nextMode);
    try {
      await fetch("/mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: nextMode }),
      });
      pushTelemetry({
        type: "system",
        message: `Mode switched to ${nextMode}.`,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      pushTelemetry({
        type: "system",
        message: `Mode switch failed: ${error.message}`,
        timestamp: new Date().toISOString(),
      });
    }
  };

  const startMovement = (command) => {
    if (movementRef.current.current === command) return;
    movementRef.current.current = command;
    sendCommand(command, { continuous: true });
    movementRef.current.timer = setInterval(() => {
      sendCommand(command, { continuous: true });
    }, 200);
  };

  const stopMovement = () => {
    if (movementRef.current.timer) {
      clearInterval(movementRef.current.timer);
      movementRef.current.timer = null;
    }
    movementRef.current.current = null;
    sendStop();
  };

  useEffect(() => {
    const keyMap = {
      KeyW: COMMANDS.forward,
      ArrowUp: COMMANDS.forward,
      KeyS: COMMANDS.backward,
      ArrowDown: COMMANDS.backward,
      KeyA: COMMANDS.left,
      ArrowLeft: COMMANDS.left,
      KeyD: COMMANDS.right,
      ArrowRight: COMMANDS.right,
    };

    const handleKeyDown = (event) => {
      if (keyMap[event.code]) {
        event.preventDefault();
        startMovement(keyMap[event.code]);
      }
    };

    const handleKeyUp = (event) => {
      if (keyMap[event.code]) {
        event.preventDefault();
        stopMovement();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  const handleJoystickMove = (payload) => {
    if (!socketRef.current) return;
    socketRef.current.emit("joystick", payload);
    setLastCommand(`JOYSTICK (${payload.speed})`);
  };

  const handleJoystickStop = () => {
    if (!socketRef.current) return;
    socketRef.current.emit("joystick", { speed: 0, vector: { x: 0, y: 0 } });
    sendStop();
  };

  const chatLog = useMemo(
    () =>
      telemetry.map((item, index) => (
        <div key={`${item.timestamp}-${index}`} className={`chat-item ${item.type || "system"}`}>
          <strong>{item.type === "rover" ? "Rover" : "System"}:</strong> {item.message}
        </div>
      )),
    [telemetry]
  );

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>Mars Rover Command Center</h1>
          <p className="muted">Mission-control interface for local WiFi rover operations.</p>
        </div>
        <div className="status">
          <div className={`badge ${connectionStatus}`}>
            <span></span>
            {connectionStatus === "connected" ? "Link Active" : "Link Lost"}
          </div>
          <div className="badge">
            Mode: {mode}
          </div>
        </div>
      </header>

      <section className="panel">
        <h3>Movement Controls</h3>
        <div className="controls">
          <div></div>
          <button
            className="control-button"
            onMouseDown={() => startMovement(COMMANDS.forward)}
            onMouseUp={stopMovement}
            onMouseLeave={stopMovement}
            onTouchStart={() => startMovement(COMMANDS.forward)}
            onTouchEnd={stopMovement}
          >
            Forward
          </button>
          <div></div>
          <button
            className="control-button"
            onMouseDown={() => startMovement(COMMANDS.left)}
            onMouseUp={stopMovement}
            onMouseLeave={stopMovement}
            onTouchStart={() => startMovement(COMMANDS.left)}
            onTouchEnd={stopMovement}
          >
            Left
          </button>
          <button className="control-button" onClick={sendStop}>
            Hover Stop
          </button>
          <button
            className="control-button"
            onMouseDown={() => startMovement(COMMANDS.right)}
            onMouseUp={stopMovement}
            onMouseLeave={stopMovement}
            onTouchStart={() => startMovement(COMMANDS.right)}
            onTouchEnd={stopMovement}
          >
            Right
          </button>
          <div></div>
          <button
            className="control-button"
            onMouseDown={() => startMovement(COMMANDS.backward)}
            onMouseUp={stopMovement}
            onMouseLeave={stopMovement}
            onTouchStart={() => startMovement(COMMANDS.backward)}
            onTouchEnd={stopMovement}
          >
            Backward
          </button>
          <div></div>
          <button className="control-button stop" onClick={sendStop}>
            EMERGENCY STOP
          </button>
        </div>
      </section>

      <section className="panel">
        <h3>Virtual Joystick</h3>
        <div className="joystick">
          <Joystick onMove={handleJoystickMove} onStop={handleJoystickStop} />
        </div>
      </section>

      <section className="panel">
        <h3>Mode Control</h3>
        <div className="mode-toggle">
          <button className="control-button" onClick={() => setModeRemote("MANUAL")}>
            Manual Mode
          </button>
          <button className="control-button" onClick={() => setModeRemote("AUTONOMOUS")}>
            Autonomous Mode
          </button>
        </div>
        <div className="status-grid" style={{ marginTop: "16px" }}>
          <div className="status-item">
            <strong>Last Command</strong>
            <div>{lastCommand}</div>
          </div>
          <div className="status-item">
            <strong>Connection</strong>
            <div>{connectionStatus}</div>
          </div>
          <div className="status-item">
            <strong>Rover Mode</strong>
            <div>{mode}</div>
          </div>
          <div className="status-item">
            <strong>Telemetry Frames</strong>
            <div>{telemetry.length}</div>
          </div>
        </div>
      </section>

      <section className="panel">
        <h3>Video Stream</h3>
        <div className="video-panel">
          {cameraUrl && cameraOnline ? (
            <img
              src={cameraUrl}
              alt="ESP32-CAM Live Feed"
              onError={() => setCameraOnline(false)}
            />
          ) : (
            <div className="placeholder">Camera offline. Check ESP32-CAM stream.</div>
          )}
          <div className="video-overlay">ESP32-CAM</div>
        </div>
      </section>

      <section className="panel">
        <h3>Command Chat</h3>
        <div className="chat">
          <div className="chat-log">{chatLog}</div>
          <form
            className="chat-input"
            onSubmit={(event) => {
              event.preventDefault();
              if (!chatInput.trim()) return;
              sendCommand(chatInput.trim());
              setChatInput("");
            }}
          >
            <input
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              placeholder="Enter command (e.g., MOVE_FORWARD)"
            />
            <button type="submit">Send</button>
          </form>
        </div>
      </section>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
