// TRUE LOVERS — app.js (client)
// No frameworks: plain DOM + Socket.io. State lives in `state` and in
// localStorage only for the one thing it's safe to remember locally —
// which connection code/role/secret *this browser* last used, so
// "Re-enter your chat" works without re-typing everything. The actual
// chat data always lives on the server, never in localStorage.

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const THEMES = [
  { id: "romantic", label: "❤️ Romantic" },
  { id: "midnight", label: "🌙 Midnight" },
  { id: "galaxy", label: "🌌 Galaxy" },
  { id: "sakura", label: "🌸 Sakura" },
  { id: "minimal", label: "🤍 Minimal" }
];
const WALLPAPERS = [
  { id: "hearts", label: "❤️ Floating Hearts" },
  { id: "galaxy", label: "🌌 Galaxy" },
  { id: "sakura", label: "🌸 Sakura" },
  { id: "midnight", label: "🌙 Midnight" },
  { id: "minimal", label: "🤍 Minimal" }
];
const QUICK_EMOJIS = ["❤️","😂","😮","😢","🙏","🔥","👍","🎉"];
const EMOJI_TRAY = ["😀","😂","😍","😘","🥰","😊","😉","😢","😭","😡","🙏","👍","👏","🔥","🎉","💯","❤️","💙","💚","💜","🩷","🧡","✨","🌙","🎂","😴","🤔","😎"];

const state = {
  screen: "home",
  createType: "relationship",
  createSecretType: "pin",
  createdCode: null,
  createdSecret: null,
  code: null,
  secret: null,
  role: null,
  connection: null,
  replyTo: null,
  socket: null
};

// ---------- screen navigation ----------
function goto(screen) {
  state.screen = screen;
  $$("[data-screen]").forEach((el) => (el.hidden = el.id !== `screen-${screen}`));
}
$$("[data-goto]").forEach((el) => el.addEventListener("click", () => goto(el.dataset.goto)));

function showError(elId, msg) {
  $(elId).textContent = msg || "";
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), 2600);
}

// ---------- CREATE flow ----------
$("#create-type").addEventListener("click", (e) => {
  const btn = e.target.closest(".pill");
  if (!btn) return;
  $$("#create-type .pill").forEach((p) => p.classList.remove("active"));
  btn.classList.add("active");
  state.createType = btn.dataset.type;
});

$("#create-secret-type").addEventListener("click", (e) => {
  const btn = e.target.closest(".pill");
  if (!btn) return;
  $$("#create-secret-type .pill").forEach((p) => p.classList.remove("active"));
  btn.classList.add("active");
  state.createSecretType = btn.dataset.secret;
  $("#create-secret").placeholder = btn.dataset.secret === "word" ? "e.g. sunflower" : "e.g. 4582";
});

$("#btn-create-submit").addEventListener("click", async () => {
  showError("#create-error", "");
  const firstMessage = $("#first-message").value.trim();
  const secret = $("#create-secret").value.trim();
  if (!firstMessage) return showError("#create-error", "Write a first message to send.");
  if (!secret) return showError("#create-error", "Set a Secret PIN or Secret Word.");

  try {
    const res = await fetch("/api/connections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstMessage,
        secret,
        secretType: state.createSecretType,
        type: state.createType
      })
    });
    const data = await res.json();
    if (!res.ok) return showError("#create-error", data.error || "Something went wrong.");

    state.createdCode = data.code;
    state.createdSecret = secret;
    $("#reveal-code").textContent = data.code;
    $("#reveal-secret").textContent = secret;
    $('[data-step="1"]').hidden = true;
    $('[data-step="2"]').hidden = false;
  } catch (err) {
    showError("#create-error", "Couldn't reach the server. Is it running?");
  }
});

$("#btn-copy-details").addEventListener("click", () => {
  const text = `Connection Code: ${state.createdCode}\nSecret: ${state.createdSecret}`;
  navigator.clipboard?.writeText(text).then(() => toast("Copied — share it only with them."));
});

$("#btn-enter-chat").addEventListener("click", () => {
  enterChat(state.createdCode, state.createdSecret, "A");
});

// ---------- JOIN flow ----------
$("#btn-join-submit").addEventListener("click", async () => {
  showError("#join-error", "");
  const code = $("#join-code").value.trim().toUpperCase();
  const secret = $("#join-secret").value.trim();
  if (!code || !secret) return showError("#join-error", "Enter both the code and the secret.");

  try {
    const res = await fetch(`/api/connections/${encodeURIComponent(code)}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret })
    });
    const data = await res.json();
    if (!res.ok) return showError("#join-error", data.error || "Something went wrong.");
    enterChat(code, secret, data.role);
  } catch (err) {
    showError("#join-error", "Couldn't reach the server. Is it running?");
  }
});

// ---------- Re-enter (remembers code/role locally on this browser only) ----------
$("#btn-reenter").addEventListener("click", async () => {
  const saved = JSON.parse(localStorage.getItem("tl_last") || "null");
  if (!saved) return toast("No saved connection on this browser yet.");
  try {
    const res = await fetch(`/api/connections/${encodeURIComponent(saved.code)}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: saved.secret, role: saved.role })
    });
    const data = await res.json();
    if (!res.ok) return toast(data.error || "Could not re-enter.");
    enterChat(saved.code, saved.secret, data.role);
  } catch {
    toast("Couldn't reach the server.");
  }
});

// ---------- entering chat ----------
function enterChat(code, secret, role) {
  state.code = code;
  state.secret = secret;
  state.role = role;
  localStorage.setItem("tl_last", JSON.stringify({ code, secret, role }));

  goto("chat");
  $("#messages").innerHTML = "";

  const socket = io();
  state.socket = socket;
  socket.emit("room:enter", { code, secret, role });

  socket.on("room:error", (msg) => {
    toast(msg);
    goto("home");
  });

  socket.on("room:ready", (conn) => {
    state.connection = conn;
    renderChatHeader();
    renderAllMessages();
    applyTheme(conn.theme);
    applyWallpaper(conn.wallpaper);
    renderPinned();
    updateExclusiveUI();
  });

  socket.on("message:new", (msg) => {
    state.connection.messages.push(msg);
    appendMessage(msg);
    scrollToBottom();
  });

  socket.on("message:updated", (msg) => {
    const idx = state.connection.messages.findIndex((m) => m.id === msg.id);
    if (idx > -1) state.connection.messages[idx] = msg;
    renderAllMessages();
    renderPinned();
  });

  socket.on("settings:updated", (s) => {
    state.connection.theme = s.theme;
    state.connection.wallpaper = s.wallpaper;
    state.connection.anniversary = s.anniversary;
    applyTheme(s.theme);
    applyWallpaper(s.wallpaper);
    renderChatHeader();
    renderLoyalty();
  });

  socket.on("notes:updated", (notes) => {
    state.connection.notes = notes;
    if (!$("#drawer-notes").hidden) $("#notes-textarea").value = notes.join("\n");
  });

  socket.on("exclusive:incoming", () => {
    $("#exclusive-modal").hidden = false;
  });

  socket.on("exclusive:resolved", ({ exclusive }) => {
    state.connection.exclusive = exclusive;
    $("#exclusive-modal").hidden = true;
    updateExclusiveUI();
    renderChatHeader();
    if (exclusive) toast("❤️ Relationship Locked");
  });

  socket.on("presence:partner-online", () => toast("Your partner is here ❤️"));
  socket.on("typing", ({ isTyping }) => {
    $("#typing-indicator").hidden = !isTyping;
  });
}

$("#btn-chat-back").addEventListener("click", () => {
  state.socket?.disconnect();
  goto("home");
});

// ---------- rendering ----------
function daysConnected() {
  if (!state.connection) return 0;
  return Math.max(0, Math.floor((Date.now() - state.connection.createdAt) / 86400000));
}

function renderChatHeader() {
  const c = state.connection;
  const label = c.type === "friends" ? "💙 Best Friends Forever" : "❤️ True Lovers";
  $("#chat-title").textContent = label;
  const lock = c.exclusive ? " · Relationship Locked" : "";
  const typeLabel = c.type === "friends" ? "Friends" : "Relationship";
  $("#chat-subtitle").textContent = `${typeLabel} · Day ${daysConnected()}${lock}`;
}

function messageById(id) {
  return state.connection.messages.find((m) => m.id === id);
}

function renderAllMessages() {
  const box = $("#messages");
  box.innerHTML = "";
  state.connection.messages.forEach(appendMessage);
  scrollToBottom();
}

function appendMessage(msg) {
  const box = $("#messages");
  const mine = msg.sender === state.role;
  const row = document.createElement("div");
  row.className = `msg-row ${mine ? "mine" : "theirs"}`;
  row.dataset.id = msg.id;

  const bubble = document.createElement("div");
  bubble.className = "bubble" + (msg.deleted ? " deleted" : "");

  let inner = "";
  if (msg.replyTo) {
    const replied = messageById(msg.replyTo);
    if (replied) {
      inner += `<span class="reply-quote">${escapeHtml(replied.deleted ? "Message deleted" : replied.text).slice(0, 80)}</span>`;
    }
  }
  inner += `<span class="bubble-text">${msg.deleted ? "Message deleted" : escapeHtml(msg.text)}</span>`;

  const time = new Date(msg.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  inner += `<div class="bubble-meta"><span>${time}</span>${msg.pinned ? "<span>📌</span>" : ""}${msg.edited && !msg.deleted ? "<span>edited</span>" : ""}</div>`;

  const reactions = Object.entries(msg.reactions || {}).filter(([, v]) => v);
  if (reactions.length) {
    inner += `<div class="bubble-reactions">${reactions.map(([, e]) => e).join(" ")}</div>`;
  }

  bubble.innerHTML = inner;

  if (!msg.deleted) {
    const actions = document.createElement("div");
    actions.className = "bubble-actions";
    actions.innerHTML = `
      <button data-act="react">😊</button>
      <button data-act="reply">↩</button>
      <button data-act="pin">📌</button>
      ${mine ? '<button data-act="edit">✏️</button><button data-act="delete">🗑</button>' : ""}
    `;
    bubble.appendChild(actions);
  }

  row.appendChild(bubble);
  box.appendChild(row);
}

box_click_delegate();
function box_click_delegate() {
  $("#messages").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const row = e.target.closest(".msg-row");
    const id = row.dataset.id;
    const msg = messageById(id);
    const act = btn.dataset.act;

    if (act === "reply") {
      state.replyTo = id;
      $("#reply-bar").hidden = false;
      $("#reply-preview").textContent = msg.text;
      $("#composer-input").focus();
    } else if (act === "pin") {
      state.socket.emit("message:pin", { id, pinned: !msg.pinned });
    } else if (act === "edit") {
      const next = prompt("Edit message:", msg.text);
      if (next !== null && next.trim()) state.socket.emit("message:edit", { id, text: next.trim() });
    } else if (act === "delete") {
      if (confirm("Delete this message for everyone?")) state.socket.emit("message:delete", { id });
    } else if (act === "react") {
      openQuickReact(btn, id);
    }
  });
}

function openQuickReact(anchorBtn, id) {
  const existing = document.querySelector(".quick-react-pop");
  if (existing) existing.remove();
  const pop = document.createElement("div");
  pop.className = "quick-react-pop";
  pop.style.cssText = "position:absolute;display:flex;gap:4px;background:var(--panel-2);border:1px solid var(--panel-border);border-radius:10px;padding:4px 6px;z-index:5;font-size:16px;";
  QUICK_EMOJIS.forEach((e) => {
    const s = document.createElement("span");
    s.textContent = e;
    s.style.cursor = "pointer";
    s.addEventListener("click", () => {
      state.socket.emit("message:react", { id, emoji: e });
      pop.remove();
    });
    pop.appendChild(s);
  });
  const rect = anchorBtn.getBoundingClientRect();
  pop.style.top = `${rect.top - 40 + window.scrollY}px`;
  pop.style.left = `${rect.left}px`;
  document.body.appendChild(pop);
  setTimeout(() => document.addEventListener("click", function h(ev) {
    if (!pop.contains(ev.target)) { pop.remove(); document.removeEventListener("click", h); }
  }), 0);
}

function renderPinned() {
  const pinned = state.connection.messages.filter((m) => m.pinned && !m.deleted);
  const bar = $("#pinned-bar");
  if (!pinned.length) { bar.hidden = true; return; }
  bar.hidden = false;
  $("#pinned-text").textContent = pinned[pinned.length - 1].text.slice(0, 60);
}

function scrollToBottom() {
  const box = $("#messages");
  box.scrollTop = box.scrollHeight;
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

function applyTheme(theme) {
  document.body.dataset.theme = theme;
}
function applyWallpaper(wallpaper) {
  $("#messages").dataset.wallpaper = wallpaper;
}

// ---------- composer ----------
$("#btn-cancel-reply").addEventListener("click", () => {
  state.replyTo = null;
  $("#reply-bar").hidden = true;
});

$("#btn-send").addEventListener("click", sendMessage);
$("#composer-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendMessage();
});
let typingTimeout;
$("#composer-input").addEventListener("input", () => {
  state.socket?.emit("typing", true);
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => state.socket?.emit("typing", false), 1200);
});

function sendMessage() {
  const input = $("#composer-input");
  const text = input.value.trim();
  if (!text || !state.socket) return;
  state.socket.emit("message:send", { text, replyTo: state.replyTo });
  input.value = "";
  state.replyTo = null;
  $("#reply-bar").hidden = true;
}

$("#btn-emoji").addEventListener("click", () => {
  const tray = $("#emoji-tray");
  if (tray.hidden) {
    tray.innerHTML = EMOJI_TRAY.map((e) => `<span>${e}</span>`).join("");
    tray.hidden = false;
  } else {
    tray.hidden = true;
  }
});
$("#emoji-tray").addEventListener("click", (e) => {
  if (e.target.tagName === "SPAN") {
    $("#composer-input").value += e.target.textContent;
    $("#composer-input").focus();
  }
});

// ---------- search ----------
$("#btn-open-search").addEventListener("click", () => {
  $("#search-bar").hidden = false;
  $("#search-input").focus();
});
$("#btn-close-search").addEventListener("click", () => {
  $("#search-bar").hidden = true;
  $("#search-input").value = "";
  renderAllMessages();
});
$("#search-input").addEventListener("input", (e) => {
  const q = e.target.value.toLowerCase();
  $$("#messages .msg-row").forEach((row) => {
    const msg = messageById(row.dataset.id);
    const match = !q || (msg && !msg.deleted && msg.text.toLowerCase().includes(q));
    row.style.display = match ? "" : "none";
  });
});

// ---------- settings drawer ----------
$("#btn-open-settings").addEventListener("click", () => {
  buildSettingsDrawer();
  $("#drawer-settings").hidden = false;
});
$("#btn-close-settings").addEventListener("click", () => ($("#drawer-settings").hidden = true));

function buildSettingsDrawer() {
  const themeRow = $("#theme-row");
  themeRow.innerHTML = "";
  THEMES.forEach((t) => {
    const b = document.createElement("button");
    b.className = "swatch" + (state.connection.theme === t.id ? " active" : "");
    b.textContent = t.label;
    b.addEventListener("click", () => state.socket.emit("settings:update", { theme: t.id }));
    themeRow.appendChild(b);
  });

  const wallRow = $("#wallpaper-row");
  wallRow.innerHTML = "";
  WALLPAPERS.forEach((w) => {
    const b = document.createElement("button");
    b.className = "swatch" + (state.connection.wallpaper === w.id ? " active" : "");
    b.textContent = w.label;
    b.addEventListener("click", () => state.socket.emit("settings:update", { wallpaper: w.id }));
    wallRow.appendChild(b);
  });

  $("#anniversary-input").value = state.connection.anniversary || "";

  renderLoyalty();
  updateExclusiveUI();
}

$("#anniversary-input").addEventListener("change", (e) => {
  state.socket.emit("settings:update", { anniversary: e.target.value });
});

function renderLoyalty() {
  const days = daysConnected();
  const badges = [
    { label: "🥉 Bronze", need: 30 },
    { label: "🥈 Silver", need: 100 },
    { label: "🥇 Gold", need: 365 },
    { label: "💎 Diamond", need: 1000 }
  ];
  const box = $("#loyalty-stats");
  box.innerHTML = `<div class="badge earned">❤️ Day ${days}</div>` +
    badges.map((b) => `<div class="badge ${days >= b.need ? "earned" : ""}">${b.label}<br><small>${b.need}d</small></div>`).join("");
}

// ---------- exclusive mode ----------
$("#btn-request-exclusive").addEventListener("click", () => {
  state.socket.emit("exclusive:request");
  $("#exclusive-status").textContent = "Request sent — waiting for them to accept.";
});
$("#btn-accept-exclusive").addEventListener("click", () => {
  state.socket.emit("exclusive:respond", { accept: true });
  $("#exclusive-modal").hidden = true;
});
$("#btn-decline-exclusive").addEventListener("click", () => {
  state.socket.emit("exclusive:respond", { accept: false });
  $("#exclusive-modal").hidden = true;
});
function updateExclusiveUI() {
  const btn = $("#btn-request-exclusive");
  if (state.connection.exclusive) {
    btn.disabled = true;
    btn.textContent = "❤️ Relationship Locked";
    $("#exclusive-status").textContent = "";
  } else {
    btn.disabled = false;
    btn.textContent = "Request Exclusive Lock";
  }
}

// ---------- notes drawer ----------
$("#btn-open-notes").addEventListener("click", () => {
  $("#notes-textarea").value = (state.connection.notes || []).join("\n");
  $("#drawer-notes").hidden = false;
});
$("#btn-close-notes").addEventListener("click", () => ($("#drawer-notes").hidden = true));
let notesTimeout;
$("#notes-textarea").addEventListener("input", (e) => {
  clearTimeout(notesTimeout);
  notesTimeout = setTimeout(() => {
    const lines = e.target.value.split("\n");
    state.socket.emit("notes:update", { notes: lines });
  }, 500);
});

// close drawers by clicking backdrop
$$(".drawer").forEach((d) => d.addEventListener("click", (e) => { if (e.target === d) d.hidden = true; }));
