require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const { connectDB, getSequelize, isConnected } = require('./config/db');
const { initPlayerModel, getLeaderboard, recordGameResult } = require('./models/Player');
const { initGameModel, saveGameResult } = require('./models/Game');

console.log("Starting Crazy 8 Server v2.5...");

// ==================== GAME CONSTANTS ====================
const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SPECIAL_CARDS = ['8', '2', '7', 'J'];

// Game configuration constants
const CONFIG = {
    CARDS_PER_PLAYER: 5,
    CARDS_PER_PLAYER_TWO_PLAYER: 7,
    MIN_PLAYERS: 2,
    MAX_PLAYERS: 7,
    DEFAULT_MAX_PLAYERS: 4,
    MAX_NAME_LENGTH: 50,
    DISCONNECT_GRACE_PERIOD_MS: 30000, // 30 seconds to reconnect
    ROOM_ID_LENGTH: 6
};

// ==================== SERVER SETUP ====================
const app = express();
const server = http.createServer(app);

// Database connection flag
let dbConnected = false;

// Production CORS configuration
const allowedOrigins = process.env.NODE_ENV === 'production'
    ? ['https://khasinogaming.com', 'https://www.khasinogaming.com']
    : '*';

const io = new Server(server, {
    transports: ['websocket', 'polling'],
    cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST"]
    }
});

// Rooms State (in-memory, with optional DB persistence)
const rooms = {};

// ==================== UTILITY FUNCTIONS ====================

/**
 * Sanitizes player name to prevent XSS and limit length
 */
function sanitizeName(name) {
    if (typeof name !== 'string') return 'Player';
    return name
        .substring(0, CONFIG.MAX_NAME_LENGTH)
        .replace(/<[^>]*>/g, '')  // Remove HTML tags
        .replace(/[^\w\s-]/g, '') // Keep only alphanumeric, spaces, hyphens
        .trim() || 'Player';
}

/**
 * Validates and clamps maxPlayers to valid range
 */
function validateMaxPlayers(value) {
    const num = parseInt(value);
    if (isNaN(num)) return CONFIG.DEFAULT_MAX_PLAYERS;
    return Math.min(Math.max(num, CONFIG.MIN_PLAYERS), CONFIG.MAX_PLAYERS);
}

/**
 * Generates a random room ID
 */
function generateRoomId() {
    return Math.random().toString(36).substring(2, 2 + CONFIG.ROOM_ID_LENGTH);
}

/**
 * Finds the room a player is in by their socket ID
 */
function findPlayerRoom(socketId) {
    for (const roomId in rooms) {
        const room = rooms[roomId];
        const playerIndex = room.players.findIndex(p => p.id === socketId);
        if (playerIndex !== -1) {
            return { room, playerIndex };
        }
    }
    return null;
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
    constructor() {
        this.cards = [];
        this.reset();
    }
    reset() {
        this.cards = [];
        for (let suit of SUITS) {
            for (let rank of RANKS) {
                this.cards.push(new Card(suit, rank));
            }
        }
        this.shuffle();
    }
    shuffle() {
        for (let i = this.cards.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
        }
    }
    deal() {
        return this.cards.pop();
    }
    get isEmpty() {
        return this.cards.length === 0;
    }
}

// ==================== STATE SANITIZATION (ANTI-CHEAT) ====================

/**
 * Sends game state to each player with only their own hand visible
 * This prevents cheating by inspecting browser console
 */
function broadcastGameState(room) {
    const baseState = {
        discardPile: room.discardPile,
        currentTurn: room.currentTurn,
        gameForcedSuit: room.gameForcedSuit,
        drawPenalty: room.drawPenalty
    };

    // Send personalized state to each player
    room.players.forEach((player, index) => {
        const personalizedState = {
            ...baseState,
            players: room.players.map((p, i) => ({
                id: p.id,
                name: p.name,
                handCount: p.hand.length,
                // Only include hand for the receiving player
                hand: (i === index) ? p.hand : undefined
            })),
            myIndex: index
        };
        io.to(player.id).emit('gameState', personalizedState);
    });
}

/**
 * Legacy sanitizeState for backward compatibility (non-secure, for PVE)
 * @deprecated Use broadcastGameState for online games
 */
function sanitizeState(room) {
    return {
        players: room.players,
        discardPile: room.discardPile,
        currentTurn: room.currentTurn,
        gameForcedSuit: room.gameForcedSuit,
        drawPenalty: room.drawPenalty
    };
}

// ==================== GAME LOGIC ====================

function validateMove(room, card) {
    if (!card) return false;
    if (room.drawPenalty > 0) return card.rank === '2';

    const top = room.discardPile[room.discardPile.length - 1];
    if (!top) return true; // Empty discard pile, any card is valid

    const suit = room.gameForcedSuit || top.suit;
    return (card.rank === '8' || card.suit === suit || card.rank === top.rank);
}

function advanceTurn(room, skip = false) {
    const len = room.players.length;
    if (len === 0) return;

    let next = room.currentTurn + room.direction;
    if (skip) next += room.direction;

    // Normalize to valid index
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

function startRoomGame(room) {
    room.gameStarted = true;
    room.startedAt = new Date();
    room.deck.reset();
    room.discardPile = [];

    const cardsPerPlayer = room.players.length === 2
        ? CONFIG.CARDS_PER_PLAYER_TWO_PLAYER
        : CONFIG.CARDS_PER_PLAYER;

    room.players.forEach(p => {
        p.hand = [];
        for (let i = 0; i < cardsPerPlayer; i++) {
            p.hand.push(room.deck.deal());
        }
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

function handlePlayerDisconnect(room, playerIndex, socketId) {
    const player = room.players[playerIndex];

    if (!room.gameStarted) {
        // Game hasn't started - remove player from room
        room.players.splice(playerIndex, 1);
        io.to(room.id).emit('playerList', room.players);
        io.to(room.id).emit('playerLeft', { name: player.name });

        // If room is empty, delete it
        if (room.players.length === 0) {
            delete rooms[room.id];
            console.log(`🗑️ Room ${room.id} deleted (empty)`);
        }
    } else {
        // Game in progress - mark player as disconnected
        player.disconnected = true;
        player.disconnectedAt = Date.now();

        io.to(room.id).emit('playerDisconnected', {
            name: player.name,
            index: playerIndex
        });

        // If it was their turn, advance to next player
        if (room.currentTurn === playerIndex) {
            advanceTurn(room, false);
            broadcastGameState(room);
        }

        // Check if all players disconnected
        const connectedPlayers = room.players.filter(p => !p.disconnected);
        if (connectedPlayers.length <= 1) {
            // End game - last remaining player wins (or abandon)
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
}

// ==================== EXPRESS ROUTES ====================

app.get('/health', (req, res) => {
    res.json({
        status: 'Crazy 8 Backend v2.5 Running',
        database: dbConnected ? 'PostgreSQL connected' : 'not connected (in-memory mode)',
        activeRooms: Object.keys(rooms).length
    });
});

app.get('/api/leaderboard', async (req, res) => {
    if (!dbConnected) {
        return res.json({ error: 'Database not connected', leaderboard: [] });
    }
    try {
        const leaderboard = await getLeaderboard(10);
        res.json({ leaderboard });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== SOCKET.IO EVENT HANDLERS ====================

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

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
        rooms[roomId] = {
            id: roomId,
            players: [{ id: socket.id, name: name, hand: [] }],
            maxPlayers: maxPlayers,
            deck: new Deck(),
            discardPile: [],
            currentTurn: 0,
            direction: 1,
            drawPenalty: 0,
            gameStarted: false,
            gameForcedSuit: null,
            createdAt: new Date()
        };

        socket.join(roomId);
        socket.emit('roomCreated', roomId);
        io.to(roomId).emit('playerList', rooms[roomId].players);
        console.log(`🎲 Room ${roomId} created by ${name}`);
    });

    socket.on('joinRoom', ({ roomId, name }) => {
        if (!roomId || typeof roomId !== 'string') {
            socket.emit('error', 'Invalid room ID');
            return;
        }

        const room = rooms[roomId];
        if (!room) {
            socket.emit('error', 'Room not found');
            return;
        }
        if (room.gameStarted) {
            socket.emit('error', 'Game already started');
            return;
        }
        if (room.players.length >= room.maxPlayers) {
            socket.emit('error', 'Room is full');
            return;
        }

        const sanitizedName = sanitizeName(name);
        room.players.push({ id: socket.id, name: sanitizedName, hand: [] });
        socket.join(roomId);
        socket.emit('joinedRoom', roomId);
        io.to(roomId).emit('playerList', room.players);
        console.log(`👋 ${sanitizedName} joined room ${roomId}`);
    });

    socket.on('quickMatch', ({ name }) => {
        const sanitizedName = sanitizeName(name);

        // Find an available room (not started, not full)
        let availableRoom = null;
        for (const roomId in rooms) {
            const room = rooms[roomId];
            if (!room.gameStarted && room.players.length < room.maxPlayers) {
                availableRoom = room;
                break;
            }
        }

        if (availableRoom) {
            availableRoom.players.push({ id: socket.id, name: sanitizedName, hand: [] });
            socket.join(availableRoom.id);
            socket.emit('joinedRoom', availableRoom.id);
            io.to(availableRoom.id).emit('playerList', availableRoom.players);
            console.log(`⚡ Quick Match: ${sanitizedName} joined room ${availableRoom.id}`);
        } else {
            const roomId = generateRoomId();
            rooms[roomId] = {
                id: roomId,
                players: [{ id: socket.id, name: sanitizedName, hand: [] }],
                maxPlayers: CONFIG.DEFAULT_MAX_PLAYERS,
                deck: new Deck(),
                discardPile: [],
                currentTurn: 0,
                direction: 1,
                drawPenalty: 0,
                gameStarted: false,
                gameForcedSuit: null,
                createdAt: new Date()
            };
            socket.join(roomId);
            socket.emit('roomCreated', roomId);
            io.to(roomId).emit('playerList', rooms[roomId].players);
            console.log(`⚡ Quick Match: ${sanitizedName} created new room ${roomId}`);
        }
    });

    socket.on('startGame', (roomId) => {
        if (!roomId || typeof roomId !== 'string') return;

        const room = rooms[roomId];
        if (!room) return;

        // Only the host (first player) can start the game
        if (room.players[0]?.id !== socket.id) return;

        // Need at least 2 players
        if (room.players.length < CONFIG.MIN_PLAYERS) {
            socket.emit('error', `Need at least ${CONFIG.MIN_PLAYERS} players to start`);
            return;
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

        if (validateMove(room, card)) {
            player.hand.splice(cardIndex, 1);
            room.discardPile.push(card);
            room.gameForcedSuit = null;

            // Special Cards
            let skip = false;
            if (card.rank === '2') {
                room.drawPenalty += 2;
            } else if (card.rank === '7') {
                skip = true;
            } else if (card.rank === 'J') {
                room.direction *= -1;
            }

            // Check Win
            if (player.hand.length === 0) {
                io.to(roomId).emit('gameOver', { winner: player.name });

                if (dbConnected) {
                    saveGameResult(room, player.name).catch(err =>
                        console.error('Error saving game:', err.message)
                    );

                    room.players.forEach(p => {
                        const won = p.name === player.name;
                        recordGameResult(p.name, won).catch(err =>
                            console.error('Error recording player stats:', err.message)
                        );
                    });
                }

                delete rooms[roomId];
                return;
            }

            if (card.rank === '8') {
                // Wait for suit selection
                broadcastGameState(room);
                return;
            }

            advanceTurn(room, skip);
            broadcastGameState(room);
        }
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

        if (room.drawPenalty > 0) {
            const penalty = room.drawPenalty;
            room.drawPenalty = 0;
            for (let i = 0; i < penalty; i++) {
                if (room.deck.isEmpty) refillDeck(room);
                if (!room.deck.isEmpty) {
                    room.players[room.currentTurn].hand.push(room.deck.deal());
                }
            }
            advanceTurn(room, false);
        } else {
            if (room.deck.isEmpty) refillDeck(room);
            if (!room.deck.isEmpty) {
                room.players[room.currentTurn].hand.push(room.deck.deal());
                advanceTurn(room, false);
            }
        }
        broadcastGameState(room);
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);

        const result = findPlayerRoom(socket.id);
        if (result) {
            const { room, playerIndex } = result;
            handlePlayerDisconnect(room, playerIndex, socket.id);
        }
    });
});

// ==================== SERVER STARTUP ====================

async function startServer() {
    // Connect to database first
    dbConnected = await connectDB();

    if (dbConnected) {
        initPlayerModel();
        initGameModel();

        const sequelize = getSequelize();
        await sequelize.sync({ alter: true });
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
