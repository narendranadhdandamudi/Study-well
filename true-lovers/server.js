// TRUE LOVERS — server.js
// A small, honest backend: Express serves the static site, Socket.io handles
// real-time chat, and everything is persisted to a JSON file on disk so a
// connection survives server restarts. No accounts, no login — access to a
// connection is gated purely by knowing its Connection Code + Secret PIN/Word.

const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, "data", "db.json");
const DB_DIR = path.dirname(DB_PATH);

if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ---------- tiny JSON "database" ----------
// This is intentionally simple (a single JSON file, rewritten on every
// change). It's fine for a demo / small number of connections. If you ever
// need this to scale to real traffic, swap this module out for SQLite or
// Postgres — the rest of the app doesn't need to know the difference.

function loadDB() {
  if (!fs.existsSync(DB_PATH)) {
    return { connections: {} };
  }
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  } catch (e) {
    console.error("Could not parse db.json, starting fresh:", e.message);
    return { connections: {} };
  }
}

function saveDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

let db = loadDB();

function hashSecret(secret) {
  return crypto.createHash("sha256").update(String(secret)).digest("hex");
}

function generateCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no confusing chars
  let code = "TL-";
  for (let i = 0; i < 6; i++) {
    code += chars[crypto.randomInt(0, chars.length)];
  }
  return code;
}

function newId() {
  return crypto.randomBytes(8).toString("hex");
}

function publicConnectionView(conn) {
  // Never leak the secret hash or anything identity-revealing.
  return {
    code: conn.code,
    type: conn.type,
    exclusive: conn.exclusive,
    createdAt: conn.createdAt,
    anniversary: conn.anniversary || null,
    theme: conn.theme || "romantic",
    wallpaper: conn.wallpaper || "hearts",
    participants: conn.participants.length,
    messages: conn.messages,
    notes: conn.notes || [],
    pending: conn.pendingExclusiveRequest || null
  };
}

// ---------- REST: create + join ----------

app.post("/api/connections", (req, res) => {
  const { firstMessage, secret, secretType, type } = req.body || {};

  if (!secret || !String(secret).trim()) {
    return res.status(400).json({ error: "A Secret PIN or Secret Word is required." });
  }
  if (!firstMessage || !String(firstMessage).trim()) {
    return res.status(400).json({ error: "The first message can't be empty." });
  }

  let code = generateCode();
  while (db.connections[code]) code = generateCode(); // avoid rare collision

  const now = Date.now();
  const conn = {
    code,
    secretHash: hashSecret(secret),
    secretType: secretType === "word" ? "word" : "pin",
    type: type === "friends" ? "friends" : "relationship",
    exclusive: false,
    pendingExclusiveRequest: null,
    createdAt: now,
    anniversary: null,
    theme: "romantic",
    wallpaper: "hearts",
    participants: ["A"], // roles are just "A" (creator) and "B" (joiner) — no identity beyond that
    notes: [],
    messages: [
      {
        id: newId(),
        sender: "A",
        text: String(firstMessage).trim(),
        time: now,
        edited: false,
        deleted: false,
        pinned: false,
        replyTo: null,
        reactions: {}
      }
    ]
  };

  db.connections[code] = conn;
  saveDB(db);

  res.json({ code, role: "A" });
});

app.post("/api/connections/:code/join", (req, res) => {
  const { secret } = req.body || {};
  const conn = db.connections[req.params.code];

  if (!conn) return res.status(404).json({ error: "That Connection Code doesn't exist." });
  if (hashSecret(secret) !== conn.secretHash) {
    return res.status(401).json({ error: "That PIN / Secret Word doesn't match." });
  }

  let role;
  if (conn.participants.includes("B") || conn.participants.length >= 2) {
    role = "B"; // rejoining
  } else {
    conn.participants.push("B");
    role = "B";
    saveDB(db);
  }

  res.json({ code: conn.code, role, connection: publicConnectionView(conn) });
});

app.post("/api/connections/:code/verify", (req, res) => {
  // Used when reopening a connection you already joined, to re-enter the chat.
  const { secret, role } = req.body || {};
  const conn = db.connections[req.params.code];
  if (!conn) return res.status(404).json({ error: "That Connection Code doesn't exist." });
  if (hashSecret(secret) !== conn.secretHash) {
    return res.status(401).json({ error: "That PIN / Secret Word doesn't match." });
  }
  res.json({ code: conn.code, role: role === "A" ? "A" : "B", connection: publicConnectionView(conn) });
});

// ---------- Socket.io: everything that happens live in a chat ----------

io.on("connection", (socket) => {
  let joinedCode = null;
  let myRole = null;

  socket.on("room:enter", ({ code, secret, role }) => {
    const conn = db.connections[code];
    if (!conn || hashSecret(secret) !== conn.secretHash) {
      socket.emit("room:error", "Could not verify this connection.");
      return;
    }
    joinedCode = code;
    myRole = role === "A" ? "A" : "B";
    socket.join(code);
    socket.emit("room:ready", publicConnectionView(conn));
    socket.to(code).emit("presence:partner-online");
  });

  function withConn(cb) {
    if (!joinedCode || !db.connections[joinedCode]) return;
    const conn = db.connections[joinedCode];
    cb(conn);
    saveDB(db);
  }

  socket.on("message:send", ({ text, replyTo }) => {
    if (!text || !String(text).trim()) return;
    withConn((conn) => {
      const msg = {
        id: newId(),
        sender: myRole,
        text: String(text).trim().slice(0, 4000),
        time: Date.now(),
        edited: false,
        deleted: false,
        pinned: false,
        replyTo: replyTo || null,
        reactions: {}
      };
      conn.messages.push(msg);
      io.to(joinedCode).emit("message:new", msg);
    });
  });

  socket.on("message:edit", ({ id, text }) => {
    withConn((conn) => {
      const msg = conn.messages.find((m) => m.id === id);
      if (!msg || msg.sender !== myRole || msg.deleted) return;
      msg.text = String(text).trim().slice(0, 4000);
      msg.edited = true;
      io.to(joinedCode).emit("message:updated", msg);
    });
  });

  socket.on("message:delete", ({ id }) => {
    withConn((conn) => {
      const msg = conn.messages.find((m) => m.id === id);
      if (!msg || msg.sender !== myRole) return;
      msg.deleted = true;
      msg.text = "";
      io.to(joinedCode).emit("message:updated", msg);
    });
  });

  socket.on("message:pin", ({ id, pinned }) => {
    withConn((conn) => {
      const msg = conn.messages.find((m) => m.id === id);
      if (!msg) return;
      msg.pinned = !!pinned;
      io.to(joinedCode).emit("message:updated", msg);
    });
  });

  socket.on("message:react", ({ id, emoji }) => {
    withConn((conn) => {
      const msg = conn.messages.find((m) => m.id === id);
      if (!msg) return;
      msg.reactions = msg.reactions || {};
      msg.reactions[myRole] = msg.reactions[myRole] === emoji ? null : emoji;
      io.to(joinedCode).emit("message:updated", msg);
    });
  });

  socket.on("settings:update", ({ theme, wallpaper, anniversary }) => {
    withConn((conn) => {
      if (theme) conn.theme = theme;
      if (wallpaper) conn.wallpaper = wallpaper;
      if (anniversary !== undefined) conn.anniversary = anniversary;
      io.to(joinedCode).emit("settings:updated", {
        theme: conn.theme,
        wallpaper: conn.wallpaper,
        anniversary: conn.anniversary
      });
    });
  });

  socket.on("notes:update", ({ notes }) => {
    withConn((conn) => {
      conn.notes = Array.isArray(notes) ? notes.slice(0, 200) : conn.notes;
      io.to(joinedCode).emit("notes:updated", conn.notes);
    });
  });

  // Exclusive mode requires the OTHER participant to accept — this is
  // per-connection only. Without accounts there is no persistent identity
  // to enforce "only one exclusive relationship" across different
  // Connection Codes, so that global rule from the spec isn't implemented.
  socket.on("exclusive:request", () => {
    withConn((conn) => {
      if (conn.exclusive) return;
      conn.pendingExclusiveRequest = myRole;
      socket.to(joinedCode).emit("exclusive:incoming", { from: myRole });
    });
  });

  socket.on("exclusive:respond", ({ accept }) => {
    withConn((conn) => {
      if (!conn.pendingExclusiveRequest) return;
      if (accept) {
        conn.exclusive = true;
      }
      conn.pendingExclusiveRequest = null;
      io.to(joinedCode).emit("exclusive:resolved", { exclusive: conn.exclusive });
    });
  });

  socket.on("typing", (isTyping) => {
    if (joinedCode) socket.to(joinedCode).emit("typing", { from: myRole, isTyping });
  });

  socket.on("disconnect", () => {
    if (joinedCode) socket.to(joinedCode).emit("presence:partner-offline");
  });
});

server.listen(PORT, () => {
  console.log(`True Lovers running at http://localhost:${PORT}`);
});
