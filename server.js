require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const { connectDB, getSequelize, isConnected } = require('./config/db');
const { initPlayerModel, getLeaderboard, recordGameResult } = require('./models/Player');
const { initGameModel, saveGameResult } = require('./models/Game');

console.log("Starting Crazy 8 Server v2.7...");

// ==================== GAME CONSTANTS ====================
const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SPECIAL_CARDS = ['8', '2', '7', 'J'];

const CONFIG = {
    CARDS_PER_PLAYER: 5,
    CARDS_PER_PLAYER_TWO_PLAYER: 7,
    MIN_PLAYERS: 2,
    MAX_PLAYERS: 7,
    DEFAULT_MAX_PLAYERS: 4,
    MAX_NAME_LENGTH: 50,
    ROOM_ID_LENGTH: 6
};

// ==================== SERVER SETUP ====================
const app = express();
const server = http.createServer(app);
let dbConnected = false;

const allowedOrigins = process.env.NODE_ENV === 'production'
    ? ['https://khasinogaming.com', 'https://www.khasinogaming.com']
    : '*';

const io = new Server(server, {
    transports: ['websocket', 'polling'],
    cors: { origin: allowedOrigins, methods: ["GET", "POST"] }
});

const rooms = {};

// ==================== UTILITY FUNCTIONS ====================

function sanitizeName(name) {
    if (typeof name !== 'string') return 'Player';
    return name
        .substring(0, CONFIG.MAX_NAME_LENGTH)
        .replace(/<[^>]*>/g, '')
        .replace(/[^\w\s-]/g, '')
        .trim() || 'Player';
}

function validateMaxPlayers(value) {
    const num = parseInt(value);
    if (isNaN(num)) return CONFIG.DEFAULT_MAX_PLAYERS;
    return Math.min(Math.max(num, CONFIG.MIN_PLAYERS), CONFIG.MAX_PLAYERS);
}

function generateRoomId() {
    return Math.random().toString(36).substring(2, 2 + CONFIG.ROOM_ID_LENGTH);
}

function findPlayerRoom(socketId) {
    for (const roomId in rooms) {
        const playerIndex = rooms[roomId].players.findIndex(p => p.id === socketId);
        if (playerIndex !== -1) return { room: rooms[roomId], playerIndex };
    }
    return null;
}

/**
 * Creates a new room object with default game state
 */
function createRoomObject(roomId, firstPlayer, maxPlayers = CONFIG.DEFAULT_MAX_PLAYERS) {
    return {
        id: roomId,
        players: [firstPlayer],
        maxPlayers,
        deck: new Deck(),
        discardPile: [],
        currentTurn: 0,
        direction: 1,
        drawPenalty: 0,
        gameStarted: false,
        gameForcedSuit: null,
        createdAt: new Date()
    };
}

/**
 * Draws cards from the deck, refilling from discard pile if needed
 */
function drawCardsFromDeck(room, count) {
    const drawn = [];
    for (let i = 0; i < count; i++) {
        if (room.deck.isEmpty) refillDeck(room);
        if (!room.deck.isEmpty) drawn.push(room.deck.deal());
    }
    return drawn;
}

// ==================== CARD CLASSES ====================

class Card {
    constructor(suit, rank) {
        this.suit = suit;
        this.rank = rank;
        this.id = `${rank}-${suit}`;
    }
    get color() {
        return (this.suit === 'hearts' || this.suit === 'diamonds') ? 'red' : 'black';
    }
}

class Deck {
    constructor() { this.cards = []; this.reset(); }
    reset() {
        this.cards = [];
        for (const suit of SUITS)
            for (const rank of RANKS)
                this.cards.push(new Card(suit, rank));
        this.shuffle();
    }
    shuffle() {
        for (let i = this.cards.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
        }
    }
    deal() { return this.cards.pop(); }
    get isEmpty() { return this.cards.length === 0; }
}

// ==================== ANTI-CHEAT STATE BROADCAST ====================

function broadcastGameState(room) {
    const baseState = {
        discardPile: room.discardPile,
        currentTurn: room.currentTurn,
        gameForcedSuit: room.gameForcedSuit,
        drawPenalty: room.drawPenalty
    };

    room.players.forEach((player, index) => {
        io.to(player.id).emit('gameState', {
            ...baseState,
            players: room.players.map((p, i) => ({
                id: p.id,
                name: p.name,
                handCount: p.hand.length,
                hand: (i === index) ? p.hand : undefined
            })),
            myIndex: index
        });
    });
}

// ==================== GAME LOGIC ====================

function validateMove(room, card) {
    if (!card) return false;
    if (room.drawPenalty > 0) return card.rank === '2';
    const top = room.discardPile[room.discardPile.length - 1];
    if (!top) return true;
    const suit = room.gameForcedSuit || top.suit;
    return (card.rank === '8' || card.suit === suit || card.rank === top.rank);
}

function advanceTurn(room, skip = false) {
    const len = room.players.length;
    if (len === 0) return;

    let next = room.currentTurn + room.direction;
    if (skip) next += room.direction;
    room.currentTurn = ((next % len) + len) % len;

    // Skip disconnected players
    let attempts = 0;
    while (room.players[room.currentTurn]?.disconnected && attempts < len) {
        next = room.currentTurn + room.direction;
        room.currentTurn = ((next % len) + len) % len;
        attempts++;
    }
}

function refillDeck(room) {
    if (room.discardPile.length <= 1) return;
    const top = room.discardPile.pop();
    room.deck.cards = room.discardPile;
    room.discardPile = [top];
    room.deck.shuffle();
}

/**
 * Applies special card effects and returns whether to skip the next player
 */
function applySpecialCardEffects(room, card) {
    let skip = false;
    if (card.rank === '2') room.drawPenalty += 2;
    else if (card.rank === '7') skip = true;
    else if (card.rank === 'J') room.direction *= -1;
    return skip;
}

function startRoomGame(room) {
    room.gameStarted = true;
    room.startedAt = new Date();
    room.deck.reset();
    room.discardPile = [];

    const cardsPerPlayer = room.players.length === 2
        ? CONFIG.CARDS_PER_PLAYER_TWO_PLAYER
        : CONFIG.CARDS_PER_PLAYER;

    room.players.forEach(p => {
        p.hand = drawCardsFromDeck(room, cardsPerPlayer);
    });

    // Deal starting card (no special cards)
    let startCard = room.deck.deal();
    while (SPECIAL_CARDS.includes(startCard.rank)) {
        room.deck.cards.unshift(startCard);
        room.deck.shuffle();
        startCard = room.deck.deal();
    }
    room.discardPile.push(startCard);

    io.to(room.id).emit('gameStarted');
    broadcastGameState(room);
}

/**
 * Handles win condition: emits game over, persists stats, cleans up room
 */
function handleGameWin(roomId, room, winner) {
    io.to(roomId).emit('gameOver', { winner: winner.name });

    if (dbConnected) {
        saveGameResult(room, winner.name).catch(err =>
            console.error('Error saving game:', err.message)
        );
        room.players.forEach(p => {
            recordGameResult(p.name, p.name === winner.name).catch(err =>
                console.error('Error recording player stats:', err.message)
            );
        });
    }

    delete rooms[roomId];
}

function handlePlayerDisconnect(room, playerIndex) {
    const player = room.players[playerIndex];

    if (!room.gameStarted) {
        room.players.splice(playerIndex, 1);
        io.to(room.id).emit('playerList', room.players);
        io.to(room.id).emit('playerLeft', { name: player.name });

        if (room.players.length === 0) {
            delete rooms[room.id];
            console.log(`🗑️ Room ${room.id} deleted (empty)`);
        }
        return;
    }

    // Game in progress - mark player as disconnected
    player.disconnected = true;
    player.disconnectedAt = Date.now();
    io.to(room.id).emit('playerDisconnected', { name: player.name, index: playerIndex });

    if (room.currentTurn === playerIndex) {
        advanceTurn(room, false);
        broadcastGameState(room);
    }

    // Check if only one player remains
    const connectedPlayers = room.players.filter(p => !p.disconnected);
    if (connectedPlayers.length <= 1) {
        if (connectedPlayers.length === 1) {
            io.to(room.id).emit('gameOver', {
                winner: connectedPlayers[0].name,
                reason: 'All other players disconnected'
            });
        }
        delete rooms[room.id];
        console.log(`🗑️ Room ${room.id} deleted (all players left)`);
    }
}

// ==================== EXPRESS ROUTES ====================

// Security Middleware: Prevent access to sensitive files & directories
app.use((req, res, next) => {
    const sensitiveFiles = ['.env', '.gitignore', 'package.json', 'package-lock.json', 'server.js', 'render.yaml', 'README.md', 'test-game.js', 'served_index.html'];
    const blockedDirs = ['/config', '/models', '/node_modules', '/.git', '/.github'];

    if (sensitiveFiles.some(file => req.path.includes(file)) ||
        blockedDirs.some(dir => req.path.startsWith(dir)) ||
        req.path.startsWith('/.')) {
        return res.status(403).send('Forbidden');
    }
    next();
});

// Serve static files (HTML, CSS, JS, Images, SEO files)
app.use(express.static(__dirname));

app.get('/health', (req, res) => {
    res.json({
        status: 'Crazy 8 Backend v2.7 Running',
        database: dbConnected ? 'PostgreSQL connected' : 'not connected (in-memory mode)',
        activeRooms: Object.keys(rooms).length
    });
});

app.get('/api/leaderboard', async (req, res) => {
    if (!dbConnected) return res.json({ error: 'Database not connected', leaderboard: [] });
    try {
        res.json({ leaderboard: await getLeaderboard(10) });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Serve index.html for the root route explicitly (though express.static covers it, this is safe)
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// ==================== SOCKET.IO EVENT HANDLERS ====================

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // --- Room Management ---

    socket.on('createRoom', (data) => {
        let name = "Player";
        let maxPlayers = CONFIG.DEFAULT_MAX_PLAYERS;

        if (typeof data === 'string') {
            name = sanitizeName(data);
        } else if (typeof data === 'object' && data !== null) {
            name = sanitizeName(data.name);
            maxPlayers = validateMaxPlayers(data.maxPlayers);
        }

        const roomId = generateRoomId();
        rooms[roomId] = createRoomObject(roomId, { id: socket.id, name, hand: [] }, maxPlayers);

        socket.join(roomId);
        socket.emit('roomCreated', roomId);
        io.to(roomId).emit('playerList', rooms[roomId].players);
        console.log(`🎲 Room ${roomId} created by ${name}`);
    });

    socket.on('joinRoom', ({ roomId, name }) => {
        if (!roomId || typeof roomId !== 'string') return socket.emit('error', 'Invalid room ID');

        const room = rooms[roomId];
        if (!room) return socket.emit('error', 'Room not found');
        if (room.gameStarted) return socket.emit('error', 'Game already started');
        if (room.players.length >= room.maxPlayers) return socket.emit('error', 'Room is full');

        const sanitizedName = sanitizeName(name);
        room.players.push({ id: socket.id, name: sanitizedName, hand: [] });
        socket.join(roomId);
        socket.emit('joinedRoom', roomId);
        io.to(roomId).emit('playerList', room.players);
        console.log(`👋 ${sanitizedName} joined room ${roomId}`);
    });

    socket.on('quickMatch', ({ name }) => {
        const sanitizedName = sanitizeName(name);
        const player = { id: socket.id, name: sanitizedName, hand: [] };

        // Find an available room
        const availableRoom = Object.values(rooms).find(
            r => !r.gameStarted && r.players.length < r.maxPlayers
        );

        if (availableRoom) {
            availableRoom.players.push(player);
            socket.join(availableRoom.id);
            socket.emit('joinedRoom', availableRoom.id);
            io.to(availableRoom.id).emit('playerList', availableRoom.players);
            console.log(`⚡ Quick Match: ${sanitizedName} joined room ${availableRoom.id}`);
        } else {
            const roomId = generateRoomId();
            rooms[roomId] = createRoomObject(roomId, player);
            socket.join(roomId);
            socket.emit('roomCreated', roomId);
            io.to(roomId).emit('playerList', rooms[roomId].players);
            console.log(`⚡ Quick Match: ${sanitizedName} created room ${roomId}`);
        }
    });

    // --- Game Actions ---

    socket.on('startGame', (roomId) => {
        if (!roomId || typeof roomId !== 'string') return;
        const room = rooms[roomId];
        if (!room || room.players[0]?.id !== socket.id) return;

        if (room.players.length < CONFIG.MIN_PLAYERS) {
            return socket.emit('error', `Need at least ${CONFIG.MIN_PLAYERS} players to start`);
        }
        startRoomGame(room);
    });

    socket.on('playCard', ({ roomId, cardIndex }) => {
        if (!roomId || typeof roomId !== 'string') return;
        if (typeof cardIndex !== 'number' || cardIndex < 0) return;

        const room = rooms[roomId];
        if (!room || !room.gameStarted) return;

        const playerIdx = room.players.findIndex(p => p.id === socket.id);
        if (playerIdx === -1 || playerIdx !== room.currentTurn) return;

        const player = room.players[playerIdx];
        if (cardIndex >= player.hand.length) return;

        const card = player.hand[cardIndex];
        if (!validateMove(room, card)) return;

        player.hand.splice(cardIndex, 1);
        room.discardPile.push(card);
        room.gameForcedSuit = null;

        const skip = applySpecialCardEffects(room, card);

        // Check win
        if (player.hand.length === 0) {
            handleGameWin(roomId, room, player);
            return;
        }

        // Wait for suit selection on 8s
        if (card.rank === '8') {
            broadcastGameState(room);
            return;
        }

        advanceTurn(room, skip);
        broadcastGameState(room);
    });

    socket.on('pickSuit', ({ roomId, suit }) => {
        if (!roomId || typeof roomId !== 'string') return;
        if (!suit || !SUITS.includes(suit)) return;

        const room = rooms[roomId];
        if (!room || !room.gameStarted) return;
        if (room.players[room.currentTurn]?.id !== socket.id) return;

        room.gameForcedSuit = suit;
        advanceTurn(room, false);
        broadcastGameState(room);
    });

    socket.on('drawCard', (roomId) => {
        if (!roomId || typeof roomId !== 'string') return;

        const room = rooms[roomId];
        if (!room || !room.gameStarted) return;
        if (room.players[room.currentTurn]?.id !== socket.id) return;

        const player = room.players[room.currentTurn];

        if (room.drawPenalty > 0) {
            player.hand.push(...drawCardsFromDeck(room, room.drawPenalty));
            room.drawPenalty = 0;
        } else {
            player.hand.push(...drawCardsFromDeck(room, 1));
        }

        advanceTurn(room, false);
        broadcastGameState(room);
    });

    // --- Disconnect ---

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        const result = findPlayerRoom(socket.id);
        if (result) handlePlayerDisconnect(result.room, result.playerIndex);
    });
});

// ==================== SERVER STARTUP ====================

async function startServer() {
    dbConnected = await connectDB();

    if (dbConnected) {
        initPlayerModel();
        initGameModel();
        await getSequelize().sync({ alter: true });
        console.log('✅ Database tables synced');
    }

    const PORT = process.env.PORT || 3001;
    server.listen(PORT, () => {
        console.log(`🚀 Server running on port ${PORT}`);
        console.log(`📊 Database: ${dbConnected ? 'Connected' : 'Running in memory mode'}`);
    });
}

startServer().catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
});
