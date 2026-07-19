# ❤️ True Lovers

"This is how loyalty looks."

A private, no-account chat. Access to a conversation is controlled entirely
by a **Connection Code** + a **Secret PIN/Word** — nothing else.

## Run it (in VS Code)

1. Open this folder in VS Code.
2. Open a terminal (`` Ctrl+` ``) and run:
   ```bash
   npm install
   npm start
   ```
3. Open **http://localhost:3000** in your browser.
4. Click **Create Connection**, write a first message, set a PIN/word, then
   share the generated **Connection Code + Secret** with the other person.
5. They open the same URL (on their own computer/phone, once you're both on
   the same network or you've deployed it somewhere reachable) and click
   **Join Connection**, entering the code + secret.
6. Chat in real time. Close the tab, restart your computer, come back later —
   click **Join Connection** again (or **Re-enter your chat**) with the same
   code + secret and the conversation is still there, because it's stored on
   the server, not in the browser.

Data is stored in `data/db.json`, created automatically on first run. Delete
that file to wipe all connections.

## What's actually implemented

- Create/Join with Connection Code + hashed Secret PIN/Word (no accounts)
- Real-time chat via Socket.io: send, edit, delete-for-everyone, reply,
  react, pin, search
- Relationship vs. Friends connection type
- Exclusive Mode with mutual accept/decline
- Anniversary date, days-connected counter, loyalty badges (Bronze/Silver/
  Gold/Diamond)
- Theme + wallpaper picker, shared notes, emoji picker
- Typing indicator, partner-online toast

## What's intentionally NOT implemented (and why)

The original spec described a much bigger product. These pieces need real
infrastructure beyond a demo web app, so rather than fake them, they're left
out — happy to build any of these next if you want to go further:

- **Voice/video calls** — needs WebRTC plus a signaling server and (for
  most networks) a TURN relay. Different project, not a checkbox.
- **True end-to-end encryption** — without accounts there's no public-key
  identity to encrypt *to*. Messages here are protected by the Connection
  Code/Secret and by not being sent to anyone else, but the server can read
  them in transit, same as most chat apps without dedicated E2EE work.
- **Global "only one Exclusive relationship" enforcement** — since there
  are no accounts, there's no persistent identity to check that against
  across *different* Connection Codes. Exclusive Mode here is scoped to a
  single connection.
- **Media uploads (photos/videos/voice notes/documents), Memory Vault,
  auto-delete timers, Love Timeline/Calendar stats, mini-games, Watch/Listen
  Together, AI features (date ideas, love-letter generator, etc.)** — all
  reasonable follow-ups, just out of scope for a first working version.

## Project structure

```
true-lovers/
├── server.js          Express + Socket.io backend, JSON-file persistence
├── package.json
├── data/db.json        Created automatically — your chat data lives here
└── public/
    ├── index.html
    ├── styles.css
    └── app.js
```
