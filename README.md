# 🃏 Crazy 8s - Multiplayer Card Game

A modern, web-based implementation of the classic card game **Crazy 8s**, featuring both single-player (vs AI) and real-time online multiplayer modes with persistent player stats.

## 🎮 Play Now

**Live Game:** [https://khasinogaming.com/crazy8/](https://khasinogaming.com/crazy8/)

## ✨ Features

### Game Modes
- **🤖 vs Computer:** Play locally against smart AI bots (2-7 players)
- **🌐 Online Multiplayer:** Create private rooms and invite friends to play in real-time

### Special Cards
| Card | Name | Effect |
|------|------|--------|
| **8** | Crazy 8 | Wild card - change the active suit to any suit |
| **2** | Draw Two | Next player draws 2 cards. Can be stacked! |
| **7** | Skip | Skips the next player's turn |
| **J** | Reverse | Reverses the direction of play |

### Technical Features
- **Real-Time Multiplayer:** Powered by Socket.io for instant game updates
- **Responsive Design:** Works on desktop and mobile devices
- **Player Stats:** PostgreSQL database tracks wins, losses, and games played
- **Leaderboard:** API endpoint for top players

## 🚀 How to Play

1. **Objective:** Be the first player to empty your hand
2. **On Your Turn:** Play a card matching the **Rank** or **Suit** of the discard pile
3. **No Match?** Draw from the deck until you find a playable card
4. **Win:** Empty your hand to win!

## 🛠️ Project Structure

```
crazy8/
├── server.js           # Backend server (Socket.io + Express)
├── script.js           # Frontend game logic
├── index.html          # Main game page
├── style.css           # Game styling
├── config/
│   └── db.js           # PostgreSQL connection
├── models/
│   ├── Player.js       # Player model (stats tracking)
│   └── Game.js         # Game session model
├── package.json        # Dependencies
└── render.yaml         # Render deployment config
```

## 💻 Local Development

### Prerequisites
- [Node.js](https://nodejs.org/) v18+
- PostgreSQL (optional - runs without DB in memory mode)

### Setup

```bash
# Clone the repository
git clone https://github.com/Malungisa-Mndzebele/crazy8.git
cd crazy8

# Install dependencies
npm install

# Create .env file (optional, for database)
cp .env.example .env
# Edit .env and add your DATABASE_URL

# Start the server
npm start
```

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | PostgreSQL connection string | No (graceful fallback) |
| `PORT` | Server port (default: 3001) | No |

## 🌐 Deployment on Render

### Backend (Web Service)

1. Create a **New Web Service** on [Render](https://render.com/)
2. Connect your GitHub repository
3. Configure:
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
4. Deploy!

### Database (PostgreSQL)

1. Create a **New PostgreSQL** database on Render
2. Copy the **Internal Database URL**
3. Add to your Web Service as environment variable:
   - Key: `DATABASE_URL`
   - Value: `postgres://...` (your connection string)

### Frontend Hosting

The frontend files (`index.html`, `script.js`, `style.css`) can be hosted on:
- Same Render service (enable static file serving)
- Separate static hosting (GitHub Pages, Netlify, etc.)
- Your own domain

## 🔌 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Server status + DB connection |
| `/api/leaderboard` | GET | Top 10 players by wins |

## 🔧 Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | HTML5, CSS3, Vanilla JavaScript |
| **Backend** | Node.js, Express.js |
| **Real-Time** | Socket.io |
| **Database** | PostgreSQL + Sequelize ORM |
| **Hosting** | Render (Web Service + Database) |

## 📊 Database Schema

### Players Table
```sql
- id (PRIMARY KEY)
- username (UNIQUE)
- gamesPlayed, gamesWon, gamesLost
- isGuest, email, passwordHash
- createdAt, updatedAt, lastActiveAt
```

### Games Table
```sql
- id (PRIMARY KEY)
- roomId (UNIQUE)
- status (waiting/in_progress/completed/abandoned)
- playerNames (ARRAY)
- winnerName
- startedAt, endedAt
- createdAt, updatedAt
```

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
