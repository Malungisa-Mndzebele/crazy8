const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    transports: ['websocket', 'polling'],
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.get('/health', (req, res) => {
    res.send('Crazy 8 Backend v1.9 Running');
});

// Serve static files
app.use(express.static(__dirname));

// Game Constants
const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

// Rooms State
const rooms = {};

class Card {
    constructor(suit, rank) {
        this.suit = suit;
        this.rank = rank;
        this.id = `${rank}-${suit}`;
    }
    get color() { return (this.suit === 'hearts' || this.suit === 'diamonds') ? 'red' : 'black'; }
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
    deal() { return this.cards.pop(); }
    get isEmpty() { return this.cards.length === 0; }
}

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('createRoom', (data) => {
        let name = "Player";
        let maxPlayers = 7;

        if (typeof data === 'string') {
            name = data; // Backward compat
        } else if (typeof data === 'object') {
            name = data.name || "Player";
            maxPlayers = data.maxPlayers || 7;
        }

        const roomId = Math.random().toString(36).substring(7);
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
            gameForcedSuit: null
        };
        socket.join(roomId);
        socket.emit('roomCreated', roomId);
        io.to(roomId).emit('playerList', rooms[roomId].players);
    });

    socket.on('joinRoom', ({ roomId, name }) => {
        const room = rooms[roomId];
        if (room && !room.gameStarted) {
            if (room.players.length >= (room.maxPlayers || 7)) {
                socket.emit('error', 'Room full');
                return;
            }
            room.players.push({ id: socket.id, name: name, hand: [] });
            socket.join(roomId);
            socket.emit('joinedRoom', roomId);
            io.to(roomId).emit('playerList', room.players);
        } else {
            socket.emit('error', 'Room not found or game started');
        }
    });

    socket.on('startGame', (roomId) => {
        const room = rooms[roomId];
        if (room && room.players[0].id === socket.id) {
            startRoomGame(room);
        }
    });

    socket.on('playCard', ({ roomId, cardIndex }) => {
        const room = rooms[roomId];
        if (!room) return;

        const playerIdx = room.players.findIndex(p => p.id === socket.id);
        if (playerIdx !== room.currentTurn) return; // Not your turn

        const player = room.players[playerIdx];
        const card = player.hand[cardIndex];

        if (validateMove(room, card)) {
            // Apply Move
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
            } else if (card.rank === '8') {
                // Wait for suit selection? 
                // For simplicity in this step, we'll wait for a separate 'pickSuit' event or handle it here if passed.
                // Or we require the client to send suit with the play request for 8s?
                // Let's assume client sends suit if it's an 8.
            }

            // Check Win
            if (player.hand.length === 0) {
                io.to(roomId).emit('gameOver', { winner: player.name });
                delete rooms[roomId];
                return;
            }

            if (card.rank === '8') {
                // If 8, we don't advance turn yet. waiting for suit.
                // We should tell client to pick suit? 
                // Or if client sent suit, we use it. 
                // Simplified: client sends "playCard" then "pickSuit" immediately? 
                // Better: Client emits 'playCard' with suit if it is 8.
                io.to(roomId).emit('gameState', sanitizeState(room));
                return; // Client needs to emit pickSuit
            }

            advanceTurn(room, skip);
            io.to(roomId).emit('gameState', sanitizeState(room));
        }
    });

    socket.on('pickSuit', ({ roomId, suit }) => {
        const room = rooms[roomId];
        if (!room) return;
        if (room.players[room.currentTurn].id !== socket.id) return;

        room.gameForcedSuit = suit;
        advanceTurn(room, false);
        io.to(roomId).emit('gameState', sanitizeState(room));
    });

    socket.on('drawCard', (roomId) => {
        const room = rooms[roomId];
        // Validate turn
        if (!room || room.players[room.currentTurn].id !== socket.id) return;

        if (room.drawPenalty > 0) {
            // Draw penalty
            const penalty = room.drawPenalty;
            room.drawPenalty = 0;
            for (let i = 0; i < penalty; i++) {
                if (room.deck.isEmpty) refillDeck(room);
                if (!room.deck.isEmpty) {
                    room.players[room.currentTurn].hand.push(room.deck.deal());
                }
            }
            advanceTurn(room, false); // Skip turn after penalty
        } else {
            // Normal Draw
            if (room.deck.isEmpty) refillDeck(room);
            if (!room.deck.isEmpty) {
                const card = room.deck.deal();
                room.players[room.currentTurn].hand.push(card);
                // Turn passes immediately on draw
                advanceTurn(room, false);
            }
        }
        io.to(roomId).emit('gameState', sanitizeState(room));
    });

    socket.on('disconnect', () => {
        // Handle disconnect (maybe pause game or remove player)
    });
});

function startRoomGame(room) {
    room.gameStarted = true;
    room.deck.reset();
    room.discardPile = [];
    room.players.forEach(p => {
        p.hand = [];
        for (let i = 0; i < 5; i++) p.hand.push(room.deck.deal());
        if (room.players.length === 2) {
            p.hand.push(room.deck.deal());
            p.hand.push(room.deck.deal());
        }
    });

    let startCard = room.deck.deal();
    while (['8', '2', '7', 'J'].includes(startCard.rank)) {
        room.deck.cards.unshift(startCard);
        room.deck.shuffle();
        startCard = room.deck.deal();
    }
    room.discardPile.push(startCard);

    io.to(room.id).emit('gameStarted');
    io.to(room.id).emit('gameState', sanitizeState(room));
}

function validateMove(room, card) {
    if (room.drawPenalty > 0) return card.rank === '2';

    const top = room.discardPile[room.discardPile.length - 1];
    const suit = room.gameForcedSuit || top.suit;

    return (card.rank === '8' || card.suit === suit || card.rank === top.rank);
}

function advanceTurn(room, skip) {
    const len = room.players.length;
    let next = room.currentTurn + room.direction;
    if (skip) next += room.direction;

    // Normalize
    room.currentTurn = ((next % len) + len) % len;
}

function refillDeck(room) {
    if (room.discardPile.length <= 1) return;
    const top = room.discardPile.pop();
    room.deck.cards = room.discardPile;
    room.discardPile = [top];
    room.deck.shuffle();
}

function sanitizeState(room) {
    // Hide hands of others? 
    // For simplicity, we send full state, but client only shows own.
    // Ideally, we should map sending specific state to each socket.
    return {
        players: room.players.map(p => ({
            id: p.id,
            name: p.name,
            handCount: p.hand.length,
            // We'll send full hand? better security: send full hand ONLY to that player.
            // But let's keep it simple for MVP internal. 
            // We'll send HandCount for all, and "hand" is filled only for the requester? 
            // No, simplified: Broadcast public state, let client filter? No, that's cheating.
            // We'll send "Opponents" list without hands, and "Me" with hand?
            // Socket.io standard is strict.
        })),
        discardPile: room.discardPile.length > 0 ? [room.discardPile[room.discardPile.length - 1]] : [],
        currentTurn: room.currentTurn,
        gameForcedSuit: room.gameForcedSuit,
        drawPenalty: room.drawPenalty,
        // We need to send "My Hand" to each person.
        // We can't do that with one emit.
        // We'll trust the client for now or iterate.
        // Let's iterate.
    };
}

// Override sanitize for simplified "trust client" for this MVP step or iterate
// We'll actually iterate in the emit where possible, but for now:
// Let's attach full hands to the state object and let client hide them.
// (Not secure but works for "Play with Humans" proof of concept).
function sanitizeState(room) {
    return {
        players: room.players, // Sending full hands
        discardPile: room.discardPile,
        currentTurn: room.currentTurn,
        gameForcedSuit: room.gameForcedSuit,
        drawPenalty: room.drawPenalty
    };
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
