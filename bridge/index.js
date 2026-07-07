import express from "express";

const app = express();
const port = process.env.PORT || 3000;
const bridgeSecret = process.env.BRIDGE_SECRET || "";
const startedAt = Date.now();
const maxQueueLength = 10;
const maxDurationSeconds = 30;

let queue = [];
let lastCommand = null;
let lastPollTime = null;

app.use(express.json({ limit: "32kb" }));

function clampNumber(value, min, max, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, number));
}

function clampInteger(value, min, max, fallback = min) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.round(number)));
}

function durationFrom(body) {
  const raw = body.sec ?? body.seconds ?? body.duration ?? 0;
  return clampNumber(raw, 0, maxDurationSeconds, 0);
}

function isAuthorized(req) {
  if (!bridgeSecret) {
    return true;
  }
  return req.get("x-bridge-secret") === bridgeSecret || req.query.secret === bridgeSecret;
}

function requireAuth(req, res, next) {
  if (!isAuthorized(req)) {
    return res.status(401).json({
      ok: false,
      status: "unauthorized"
    });
  }
  return next();
}

function enqueue(command) {
  queue.push(command);
  while (queue.length > maxQueueLength) {
    queue.shift();
  }
  lastCommand = command;
}

function normalizeCommand(body = {}) {
  if (body.stop === true) {
    return {
      type: "stop",
      stop: true
    };
  }

  const command = {
    type: "command",
    sec: durationFrom(body)
  };

  if (body.speed !== undefined) {
    command.speed = clampNumber(body.speed, 0, 1, 0);
  }
  if (body.intensity !== undefined) {
    command.intensity = clampNumber(body.intensity, 0, 1, 0);
  }
  if (body.suck !== undefined) {
    command.suck = clampNumber(body.suck, 0, 1, 0);
  }
  if (body.pattern !== undefined) {
    command.pattern = clampInteger(body.pattern, 1, 8, 1);
  }
  if (body.level !== undefined) {
    command.level = clampNumber(body.level, 0, 1, 0);
  }

  if (
    command.speed === undefined &&
    command.intensity === undefined &&
    command.suck === undefined &&
    command.pattern === undefined &&
    command.level === undefined
  ) {
    command.speed = 0;
  }

  return command;
}

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    status: "healthy",
    uptime: Math.round((Date.now() - startedAt) / 1000)
  });
});

app.get("/toy-next", requireAuth, (req, res) => {
  lastPollTime = new Date().toISOString();
  const command = queue.shift();
  if (!command) {
    return res.json({
      ok: true,
      status: "empty",
      type: "hello"
    });
  }
  return res.json({
    ok: true,
    status: "command",
    ...command
  });
});

app.post("/toy-command", requireAuth, (req, res) => {
  const command = normalizeCommand(req.body);
  enqueue(command);
  res.json({
    ok: true,
    status: "queued",
    command,
    queueLength: queue.length
  });
});

app.post("/toy-stop", requireAuth, (req, res) => {
  const command = {
    type: "stop",
    stop: true
  };
  enqueue(command);
  res.json({
    ok: true,
    status: "queued",
    command,
    queueLength: queue.length
  });
});

app.get("/toy-status", requireAuth, (req, res) => {
  res.json({
    ok: true,
    status: "ok",
    queueLength: queue.length,
    lastCommand,
    lastPollTime,
    uptime: Math.round((Date.now() - startedAt) / 1000)
  });
});

app.use((req, res) => {
  res.status(404).json({
    ok: false,
    status: "not_found"
  });
});

app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && "body" in err) {
    return res.status(400).json({
      ok: false,
      status: "invalid_json"
    });
  }
  console.error(err);
  return res.status(500).json({
    ok: false,
    status: "server_error"
  });
});

app.listen(port, () => {
  console.log(`SVAKOM Railway bridge listening on port ${port}`);
  if (!bridgeSecret) {
    console.warn("BRIDGE_SECRET is not set; bridge endpoints are unauthenticated.");
  }
});
