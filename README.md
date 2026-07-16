# 🃏 Crazy 8s - Card Game

A modern, **fully serverless** web implementation of the classic card game **Crazy 8s**, featuring single-player (vs AI) and peer-to-peer online multiplayer. No backend required — the whole game is static files plus WebRTC.

## 🎮 Play Now

**Live Game:** [https://khasinogaming.com/crazy8/](https://khasinogaming.com/crazy8/)

## ✨ Features

### Game Modes
- **🤖 vs Computer:** Play against smart AI bots (2-7 players), 100% in your browser
- **🌐 Online Multiplayer:** Create a room, share the code, and play with friends peer-to-peer — no server, no sign-up

### Special Cards
| Card | Name | Effect |
|------|------|--------|
| **8** | Crazy 8 | Wild card - change the active suit to any suit |
| **2** | Draw Two | Next player draws 2 cards. Can be stacked! |
| **7** | Skip | Skips the next player's turn |
| **J** | Reverse | Reverses the direction of play |

### Technical Features
- **Serverless Multiplayer:** Peer-to-peer over WebRTC (via [PeerJS](https://peerjs.com/)) — the room host runs the authoritative game engine in-browser and relays state directly to peers
- **No Backend:** Deploys as pure static files to any host (no Node server, no database)
- **Anti-Cheat:** Each player only ever receives their own hand
- **Resilient:** Application-level heartbeats detect silent disconnects (closed tabs / dropped connections) that WebRTC alone misses
- **Responsive Design:** Works on desktop and mobile devices

## 🚀 How to Play

1. **Objective:** Be the first player to empty your hand
2. **On Your Turn:** Play a card matching the **Rank** or **Suit** of the discard pile
3. **No Match?** Draw from the deck until you find a playable card
4. **Win:** Empty your hand to win!

## 🛠️ Project Structure

```
crazy8/
├── index.html          # Main game page
├── script.js           # Frontend UI + P2P networking (PeerJS)
├── game-engine.js      # Shared host-authoritative rules engine
├── style.css           # Game styling & animations
├── serve.js            # Minimal static dev server (Node built-ins only)
├── test-game.js        # Full test suite (unit + PvE sims + engine)
├── rules.html          # How-to-play page
└── package.json        # Scripts only — zero runtime dependencies
```

## 🌐 How Online Play Works (P2P)

There is **no game server**. When you create a room:

1. Your browser registers on the free public **PeerJS** signaling broker under a short room code.
2. Friends who enter that code open a direct **WebRTC** data connection to you (the host).
3. Your browser runs `game-engine.js` as the **authoritative** game and relays state to each peer; peers send their moves back to you.
4. Heartbeats keep everyone in sync and detect anyone who drops.

This means the game works anywhere you can serve static files — no Node process, no database.

## 💻 Local Development

### Prerequisites
- [Node.js](https://nodejs.org/) v18+ (only to run the local static server and tests)

### Setup

```bash
git clone https://github.com/Malungisa-Mndzebele/crazy8.git
cd crazy8

# No dependencies to install — start the static server
npm start          # → http://localhost:3001

# Run the full test suite
npm test
```

> Online play needs internet access to reach the public PeerJS broker. PvE works fully offline.

## 🚀 Deployment

Because the app is 100% static, deploy the files to any static host — GitHub Pages, Netlify, Cloudflare Pages, or plain FTP. This repo auto-deploys to `khasinogaming.com` via the FTP GitHub Action in `.github/workflows/ftp-deploy.yml` on every push to `main`.

## 🔧 Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | HTML5, CSS3, Vanilla JavaScript |
| **Multiplayer** | WebRTC (peer-to-peer) via PeerJS |
| **Hosting** | Any static host (FTP / GitHub Pages / Netlify / …) |

## 🎯 Game Rules

1. Each player starts with 5 cards (7 cards in 2-player games)
2. Match either the **suit** or **rank** of the top card
3. **8s** are wild - play anytime and pick a new suit
4. **2s** stack - play a 2 to pass the penalty to the next player
5. If you can't play, draw until you can
6. First to empty their hand wins!

## 📄 License

This project is open-source and available for personal and educational use.

---

Made with ❤️ by [Malungisa Mndzebele](https://github.com/Malungisa-Mndzebele)
