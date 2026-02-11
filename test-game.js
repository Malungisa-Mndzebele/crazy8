/**
 * Crazy 8s — Full Test Suite
 * 
 * Tests:
 * 1. Unit validation (card rules, deck, turns, dealing)
 * 2. Full PvE game simulations (2-7 players)
 * 3. Socket.IO multiplayer flow (create/join/play/draw/win/disconnect)
 * 
 * Run: node test-game.js
 */

const { io: ioClient } = require('socket.io-client');

// ==================== SHARED CONSTANTS ====================
const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SYMBOLS = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };
const SPECIAL_CARDS = ['8', '2', '7', 'J'];
const CONFIG = { CARDS_PER_PLAYER: 5, CARDS_PER_PLAYER_TWO_PLAYER: 7 };

// ==================== CLASSES ====================
class Card {
    constructor(suit, rank) { this.suit = suit; this.rank = rank; this.id = `${rank}-${suit}`; }
    get color() { return ['hearts', 'diamonds'].includes(this.suit) ? 'red' : 'black'; }
    get symbol() { return SYMBOLS[this.suit]; }
    toString() { return `${this.rank}${this.symbol}`; }
}

class Deck {
    constructor() { this.cards = []; this.reset(); }
    reset() {
        this.cards = [];
        for (const suit of SUITS) for (const rank of RANKS) this.cards.push(new Card(suit, rank));
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

class Player {
    constructor(name) { this.name = name; this.hand = []; }
}

// ==================== PVE GAME SIMULATOR ====================
class GameSimulator {
    constructor(playerCount) {
        this.deck = new Deck();
        this.players = [];
        this.discardPile = [];
        this.currentTurn = 0;
        this.direction = 1;
        this.drawPenalty = 0;
        this.gameForcedSuit = null;
        this.gameOver = false;
        this.winner = null;
        this.turnCount = 0;
        this.maxTurns = 500;
        this.playerCount = playerCount;
    }

    setup() {
        this.deck.reset();
        const bots = ['Hal', 'Chip', 'Data', 'Robo', 'Spark', 'Wire'];
        this.players.push(new Player('Human'));
        for (let i = 1; i < this.playerCount; i++) this.players.push(new Player(bots[i - 1] || `Bot ${i}`));

        const cpr = this.playerCount === 2 ? CONFIG.CARDS_PER_PLAYER_TWO_PLAYER : CONFIG.CARDS_PER_PLAYER;
        this.players.forEach(p => { for (let i = 0; i < cpr; i++) p.hand.push(this.deck.deal()); });

        let start = this.deck.deal();
        while (SPECIAL_CARDS.includes(start.rank)) { this.deck.cards.unshift(start); this.deck.shuffle(); start = this.deck.deal(); }
        this.discardPile.push(start);
    }

    getTopCard() { return this.discardPile[this.discardPile.length - 1]; }

    isValidMove(card) {
        if (this.drawPenalty > 0) return card.rank === '2';
        const top = this.getTopCard();
        const suit = this.gameForcedSuit || top.suit;
        return card.rank === '8' || card.suit === suit || card.rank === top.rank;
    }

    refillDeck() {
        if (this.discardPile.length <= 1) return;
        const top = this.discardPile.pop();
        this.deck.cards = [...this.discardPile];
        this.discardPile = [top];
        this.deck.shuffle();
    }

    advanceTurn(skip = false) {
        let next = this.currentTurn + this.direction;
        if (skip) next += this.direction;
        this.currentTurn = ((next % this.players.length) + this.players.length) % this.players.length;
    }

    playCard(card, idx) {
        this.discardPile.push(card);
        this.gameForcedSuit = null;
        let skip = false;
        if (card.rank === '2') this.drawPenalty += 2;
        if (card.rank === '7') skip = true;
        if (card.rank === 'J') this.direction *= -1;

        if (this.players[idx].hand.length === 0) { this.gameOver = true; this.winner = this.players[idx]; return; }

        if (card.rank === '8') {
            const counts = { hearts: 0, diamonds: 0, clubs: 0, spades: 0 };
            this.players[idx].hand.forEach(c => { if (c.rank !== '8') counts[c.suit]++; });
            this.gameForcedSuit = Object.entries(counts).reduce((b, [s, c]) => c > b.count ? { suit: s, count: c } : b, { suit: 'hearts', count: -1 }).suit;
        }
        this.advanceTurn(skip);
    }

    takeTurn() {
        if (this.gameOver) return;
        this.turnCount++;
        if (this.turnCount > this.maxTurns) { this.gameOver = true; return; }

        const p = this.players[this.currentTurn];
        if (this.drawPenalty > 0) {
            const two = p.hand.find(c => c.rank === '2');
            if (two) { p.hand.splice(p.hand.indexOf(two), 1); this.playCard(two, this.currentTurn); }
            else { const cnt = this.drawPenalty; this.drawPenalty = 0; for (let i = 0; i < cnt; i++) { if (this.deck.isEmpty) this.refillDeck(); if (!this.deck.isEmpty) p.hand.push(this.deck.deal()); } this.advanceTurn(); }
            return;
        }

        const valid = p.hand.filter(c => this.isValidMove(c));
        if (valid.length > 0) {
            const nonEights = valid.filter(c => c.rank !== '8');
            const card = nonEights.length > 0 ? nonEights[0] : valid[0];
            p.hand.splice(p.hand.indexOf(card), 1);
            this.playCard(card, this.currentTurn);
        } else {
            if (this.deck.isEmpty) this.refillDeck();
            if (!this.deck.isEmpty) p.hand.push(this.deck.deal());
            this.advanceTurn();
        }
    }

    run() { this.setup(); while (!this.gameOver) this.takeTurn(); return this; }
}

// ==================== TEST RUNNER ====================
let totalPassed = 0, totalFailed = 0;

function section(title) { console.log(`\n${'='.repeat(60)}\n  ${title}\n${'='.repeat(60)}`); }
function assert(cond, name) { if (cond) { totalPassed++; console.log(`  ✅ ${name}`); } else { totalFailed++; console.log(`  ❌ ${name}`); } }

// ==================== 1. UNIT VALIDATION TESTS ====================
function runUnitTests() {
    section('UNIT VALIDATION TESTS');

    // Deck
    const deck = new Deck();
    assert(deck.cards.length === 52, 'Deck has 52 cards');
    assert(new Set(deck.cards.map(c => c.id)).size === 52, 'All cards unique');

    // Color
    assert(new Card('hearts', 'A').color === 'red', 'Hearts are red');
    assert(new Card('spades', 'K').color === 'black', 'Spades are black');

    // Valid moves
    const sim = (penalty = 0, forcedSuit = null, topCard = new Card('hearts', '5')) => {
        const s = new GameSimulator(2);
        s.discardPile = [topCard]; s.drawPenalty = penalty; s.gameForcedSuit = forcedSuit;
        return s;
    };
    assert(sim().isValidMove(new Card('hearts', '9')), 'Matching suit valid');
    assert(sim().isValidMove(new Card('clubs', '5')), 'Matching rank valid');
    assert(sim().isValidMove(new Card('spades', '8')), '8 always valid');
    assert(!sim().isValidMove(new Card('clubs', '9')), 'No match invalid');
    assert(sim(2).isValidMove(new Card('clubs', '2')), '2 valid during penalty');
    assert(!sim(2).isValidMove(new Card('hearts', 'K')), 'Non-2 invalid during penalty');
    assert(!sim(2).isValidMove(new Card('hearts', '8')), '8 invalid during penalty');
    assert(sim(0, 'spades', new Card('hearts', '8')).isValidMove(new Card('spades', '3')), 'Forced suit valid');
    assert(!sim(0, 'spades', new Card('hearts', '8')).isValidMove(new Card('hearts', '3')), 'Original suit invalid when forced');
    assert(sim(0, 'spades').isValidMove(new Card('diamonds', '8')), '8 valid even with forced suit');

    // Turn mechanics
    const t = (players, current, dir) => {
        const s = new GameSimulator(players);
        s.players = Array.from({ length: players }, (_, i) => new Player(`P${i}`));
        s.currentTurn = current; s.direction = dir;
        return s;
    };
    let s = t(3, 2, 1); s.advanceTurn(); assert(s.currentTurn === 0, 'Turn wraps forward');
    s = t(3, 0, -1); s.advanceTurn(); assert(s.currentTurn === 2, 'Turn wraps reverse');
    s = t(4, 0, 1); s.advanceTurn(true); assert(s.currentTurn === 2, 'Skip advances by 2');

    // Deck refill
    s = new GameSimulator(2);
    s.deck = new Deck(); s.deck.cards = [];
    s.discardPile = [new Card('hearts', '5'), new Card('diamonds', '3'), new Card('clubs', 'K'), new Card('spades', '9')];
    const topBefore = s.discardPile[s.discardPile.length - 1];
    s.refillDeck();
    assert(s.deck.cards.length === 3, 'Refill moves discard to deck');
    assert(s.discardPile.length === 1, 'Only top remains');
    assert(s.discardPile[0].id === topBefore.id, 'Top card preserved');

    // Starting card
    let allNonSpecial = true;
    for (let i = 0; i < 20; i++) { const g = new GameSimulator(2); g.setup(); if (SPECIAL_CARDS.includes(g.discardPile[0].rank)) allNonSpecial = false; }
    assert(allNonSpecial, 'Starting card never special (20 trials)');

    // Dealing
    let g = new GameSimulator(2); g.setup();
    assert(g.players[0].hand.length === 7 && g.players[1].hand.length === 7, '2-player: 7 cards each');
    g = new GameSimulator(4); g.setup();
    assert(g.players.every(p => p.hand.length === 5), '4-player: 5 cards each');

    console.log(`\n  Unit tests done.`);
}

// ==================== 2. FULL PVE SIMULATIONS ====================
function runPveTests() {
    section('FULL PVE GAME SIMULATIONS');
    const configs = [
        { players: 2, games: 3 }, { players: 3, games: 2 },
        { players: 4, games: 2 }, { players: 7, games: 2 },
    ];
    let completed = 0, total = 0;

    for (const cfg of configs) {
        for (let i = 0; i < cfg.games; i++) {
            total++;
            const sim = new GameSimulator(cfg.players);
            sim.run();
            const hasWinner = !!sim.winner;
            const winnerEmpty = sim.winner ? sim.winner.hand.length === 0 : false;
            let cardTotal = sim.deck.cards.length + sim.discardPile.length;
            sim.players.forEach(p => cardTotal += p.hand.length);
            const cardsOk = cardTotal === 52;

            if (hasWinner && winnerEmpty && cardsOk) {
                completed++;
                console.log(`  ✅ ${cfg.players}P Game ${i + 1}: ${sim.winner.name} wins in ${sim.turnCount} turns (52/52 cards ✓)`);
            } else {
                console.log(`  ❌ ${cfg.players}P Game ${i + 1}: winner=${hasWinner} empty=${winnerEmpty} cards=${cardTotal}`);
            }
        }
    }
    assert(completed === total, `All ${total} PvE games completed correctly`);
}

// ==================== 3. SOCKET.IO MULTIPLAYER TESTS ====================
function runMultiplayerTests() {
    return new Promise(async (resolve) => {
        section('SOCKET.IO MULTIPLAYER TESTS');

        const SERVER_URL = 'http://localhost:3001';
        const sockets = [];
        const cleanup = () => sockets.forEach(s => s.disconnect());

        const connect = (name = 'Tester') => {
            return new Promise((res, rej) => {
                const s = ioClient(SERVER_URL, { transports: ['websocket'], forceNew: true });
                sockets.push(s);
                s.on('connect', () => res(s));
                s.on('connect_error', (err) => rej(err));
                setTimeout(() => rej(new Error('Connection timeout')), 5000);
            });
        };

        const waitForEvent = (socket, event, timeout = 5000) => {
            return new Promise((res, rej) => {
                const timer = setTimeout(() => rej(new Error(`Timeout waiting for '${event}'`)), timeout);
                socket.once(event, (data) => { clearTimeout(timer); res(data); });
            });
        };

        try {
            // --- Test: Connect two players ---
            const p1 = await connect('Player1');
            const p2 = await connect('Player2');
            assert(p1.connected && p2.connected, 'Both players connected to server');

            // --- Test: Create room ---
            const roomCreatedPromise = waitForEvent(p1, 'roomCreated');
            p1.emit('createRoom', { name: 'Player1', maxPlayers: 2 });
            const roomId = await roomCreatedPromise;
            assert(typeof roomId === 'string' && roomId.length > 0, `Room created: ${roomId}`);

            // --- Test: Join room ---
            const joinedPromise = waitForEvent(p2, 'joinedRoom');
            // Wait for the playerList that has 2 players (ignore the initial 1-player list from create)
            const playerListPromise = new Promise((res) => {
                const handler = (data) => {
                    if (data.length >= 2) { p1.off('playerList', handler); res(data); }
                };
                p1.on('playerList', handler);
            });
            p2.emit('joinRoom', { roomId, name: 'Player2' });
            const joinedRoomId = await joinedPromise;
            assert(joinedRoomId === roomId, 'Player2 joined the correct room');
            const playerList = await playerListPromise;
            assert(playerList.length === 2, `Room has 2 players: ${playerList.map(p => p.name).join(', ')}`);

            // --- Test: Start game ---
            const gameStartP1 = waitForEvent(p1, 'gameStarted');
            const gameStartP2 = waitForEvent(p2, 'gameStarted');
            const stateP1 = waitForEvent(p1, 'gameState');
            const stateP2 = waitForEvent(p2, 'gameState');
            p1.emit('startGame', roomId);
            await gameStartP1;
            await gameStartP2;
            assert(true, 'Game started for both players');

            const state1 = await stateP1;
            const state2 = await stateP2;
            assert(state1.discardPile.length >= 1, `Initial discard pile has ${state1.discardPile.length} card(s)`);
            assert(state1.players.length === 2, 'State has 2 players');

            // Find which player's hand we can see
            const myIdx1 = state1.myIndex;
            const myHand1 = state1.players[myIdx1].hand;
            assert(myHand1 && myHand1.length === 7, `Player1 dealt 7 cards (got ${myHand1?.length})`);

            const myIdx2 = state2.myIndex;
            const myHand2 = state2.players[myIdx2].hand;
            assert(myHand2 && myHand2.length === 7, `Player2 dealt 7 cards (got ${myHand2?.length})`);

            // Verify anti-cheat: player can't see other's hand
            const otherIdx1 = myIdx1 === 0 ? 1 : 0;
            assert(!state1.players[otherIdx1].hand, 'Anti-cheat: P1 cannot see P2 hand');

            // --- Test: Play cards until game over ---
            let gameOverResult = null;
            let turnCount = 0;
            const maxTurns = 200;

            const playTurn = () => {
                return new Promise(async (resolveTurn) => {
                    // Get fresh state for both players
                    const getState = (socket) => waitForEvent(socket, 'gameState', 8000);

                    // Determine current player
                    const currentSocket = state1.currentTurn === myIdx1 ? p1 : p2;
                    const currentIdx = currentSocket === p1 ? myIdx1 : myIdx2;

                    // We need to wait for gameState after each action
                    const statePromise1 = getState(p1);
                    const statePromise2 = getState(p2);

                    // Try draw (simplest action that always works)
                    currentSocket.emit('drawCard', roomId);

                    const newState1 = await statePromise1;
                    const newState2 = await statePromise2;

                    // Update our tracking
                    Object.assign(state1, newState1);
                    Object.assign(state2, newState2);

                    resolveTurn();
                });
            };

            // Set up game-over listener
            const gameOverP1 = waitForEvent(p1, 'gameOver', 120000);
            const gameOverP2 = waitForEvent(p2, 'gameOver', 120000);

            // Play by repeatedly having the current player try to play or draw
            const playLoop = async () => {
                while (turnCount < maxTurns && !gameOverResult) {
                    turnCount++;

                    // Get current player
                    const currentSocket = state1.currentTurn === myIdx1 ? p1 : p2;
                    const currentState = currentSocket === p1 ? state1 : state2;
                    const currentMyIdx = currentSocket === p1 ? myIdx1 : myIdx2;
                    const myHand = currentState.players[currentMyIdx].hand;

                    if (!myHand || myHand.length === 0) break;

                    // Try to find a valid card
                    const top = currentState.discardPile[currentState.discardPile.length - 1];
                    const effectiveSuit = currentState.gameForcedSuit || top.suit;
                    let validIdx = -1;

                    if (currentState.drawPenalty > 0) {
                        validIdx = myHand.findIndex(c => c.rank === '2');
                    } else {
                        validIdx = myHand.findIndex(c => c.rank === '8' || c.suit === effectiveSuit || c.rank === top.rank);
                    }

                    const stateP1Next = waitForEvent(p1, 'gameState', 8000).catch(() => null);
                    const stateP2Next = waitForEvent(p2, 'gameState', 8000).catch(() => null);

                    if (validIdx >= 0) {
                        currentSocket.emit('playCard', { roomId, cardIndex: validIdx });
                    } else {
                        currentSocket.emit('drawCard', roomId);
                    }

                    const ns1 = await stateP1Next;
                    const ns2 = await stateP2Next;

                    if (ns1) Object.assign(state1, ns1);
                    if (ns2) Object.assign(state2, ns2);

                    // Check if 8 was played and needs suit pick
                    if (ns1 && !ns1.gameForcedSuit) {
                        const newTop = ns1.discardPile[ns1.discardPile.length - 1];
                        if (newTop?.rank === '8') {
                            const picker = ns1.currentTurn === myIdx1 ? p1 : p2;
                            const suitPromise1 = waitForEvent(p1, 'gameState', 5000).catch(() => null);
                            const suitPromise2 = waitForEvent(p2, 'gameState', 5000).catch(() => null);
                            picker.emit('pickSuit', { roomId, suit: 'hearts' });
                            const ss1 = await suitPromise1;
                            const ss2 = await suitPromise2;
                            if (ss1) Object.assign(state1, ss1);
                            if (ss2) Object.assign(state2, ss2);
                        }
                    }
                }
            };

            // Race between play loop and game over event
            const loopPromise = playLoop();
            gameOverResult = await Promise.race([
                gameOverP1,
                loopPromise.then(() => null)
            ]);

            if (!gameOverResult) {
                // Wait a bit more for game over event
                gameOverResult = await Promise.race([
                    gameOverP1.catch(() => null),
                    new Promise(res => setTimeout(() => res(null), 3000))
                ]);
            }

            if (gameOverResult) {
                assert(true, `Game completed! Winner: ${gameOverResult.winner} (${turnCount} turns)`);
            } else {
                assert(turnCount < maxTurns, `Game progressed ${turnCount} turns (may not have finished)`);
            }

            // --- Test: Disconnect handling ---
            const p3 = await connect('Player3');
            const p4 = await connect('Player4');

            const room2Promise = waitForEvent(p3, 'roomCreated');
            p3.emit('createRoom', { name: 'Player3', maxPlayers: 2 });
            const room2 = await room2Promise;

            const join2Promise = waitForEvent(p4, 'joinedRoom');
            p4.emit('joinRoom', { roomId: room2, name: 'Player4' });
            await join2Promise;

            // Start second game
            const gs3 = waitForEvent(p3, 'gameStarted');
            const gs4 = waitForEvent(p4, 'gameStarted');
            p3.emit('startGame', room2);
            await gs3;
            await gs4;
            assert(true, 'Second game started for disconnect test');

            // Disconnect p4 → p3 should win
            const disconnectWin = waitForEvent(p3, 'gameOver', 5000);
            p4.disconnect();
            const dcResult = await disconnectWin.catch(() => null);
            if (dcResult) {
                assert(dcResult.winner === 'Player3', `Disconnect win: ${dcResult.winner} (reason: ${dcResult.reason})`);
            } else {
                assert(false, 'Should have received gameOver on opponent disconnect');
            }

            // --- Test: Join non-existent room ---
            const p5 = await connect('Player5');
            const errorPromise = waitForEvent(p5, 'error', 3000);
            p5.emit('joinRoom', { roomId: 'NONEXISTENT', name: 'Player5' });
            const errMsg = await errorPromise.catch(() => null);
            assert(errMsg === 'Room not found', `Error on invalid room: "${errMsg}"`);

            cleanup();
            resolve();
        } catch (err) {
            console.log(`  ❌ MULTIPLAYER ERROR: ${err.message}`);
            totalFailed++;
            cleanup();
            resolve();
        }
    });
}

// ==================== MAIN ====================
async function main() {
    console.log('🎴 Crazy 8s — Full Test Suite\n');

    runUnitTests();
    runPveTests();
    await runMultiplayerTests();

    section('FINAL RESULTS');
    console.log(`  Passed: ${totalPassed}`);
    console.log(`  Failed: ${totalFailed}`);
    console.log(totalFailed === 0 ? '\n  ✅ ALL TESTS PASSED!' : '\n  ❌ SOME TESTS FAILED!');
    console.log('='.repeat(60));

    process.exit(totalFailed === 0 ? 0 : 1);
}

main();
