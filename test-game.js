/**
 * Crazy 8s — Full Test Suite (serverless / P2P)
 *
 * Tests:
 * 1. Unit validation (card rules, deck, turns, dealing)
 * 2. Full PvE game simulations (2-7 players)
 * 3. Host-authoritative engine (game-engine.js): lobby, dealing, anti-cheat,
 *    full multiplayer game to completion, disconnect handling, validation.
 *
 * No network or server needed — the engine runs in-process.
 *
 * Run: node test-game.js
 */

const Engine = require('./game-engine.js');

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

// ==================== 3. HOST ENGINE (P2P) TESTS ====================

/**
 * Test harness around game-engine.js HostGame. Captures every message the
 * engine tries to send, and mirrors each player's latest gameState — exactly
 * what a real peer's browser would hold.
 */
function makeHarness(maxPlayers) {
    const state = {};   // playerId -> latest gameState received
    const over = {};    // playerId -> gameOver payload
    const list = { latest: null };

    const host = new Engine.HostGame({
        maxPlayers,
        send: (pid, event, data) => {
            if (event === 'gameState') state[pid] = data;
            else if (event === 'gameOver') over[pid] = data;
            else if (event === 'playerList') list.latest = data;
        }
    });
    return { host, state, over, list };
}

/** Drives a started HostGame to completion using simple valid-move logic. */
function playToCompletion(host, state, ids, maxTurns = 300) {
    let turns = 0;
    while (!host.gameOver && turns < maxTurns) {
        turns++;
        const curId = ids[host.currentTurn];
        const st = state[curId];
        if (!st) break;
        const myHand = st.players[st.myIndex].hand;
        const top = st.discardPile[st.discardPile.length - 1];
        const effectiveSuit = st.gameForcedSuit || top.suit;

        let idx = -1;
        if (st.drawPenalty > 0) idx = myHand.findIndex(c => c.rank === '2');
        else idx = myHand.findIndex(c => c.rank === '8' || c.suit === effectiveSuit || c.rank === top.rank);

        if (idx >= 0) {
            const card = myHand[idx];
            host.handleAction(curId, 'playCard', { cardIndex: idx });
            // If we just played an 8 and still hold the turn, pick a suit
            if (!host.gameOver && card.rank === '8' && host.players[host.currentTurn].id === curId) {
                host.handleAction(curId, 'pickSuit', { suit: 'hearts' });
            }
        } else {
            host.handleAction(curId, 'drawCard', {});
        }
    }
    return turns;
}

function runEngineTests() {
    section('HOST ENGINE (P2P) TESTS');

    // --- Lobby: create + join ---
    const h1 = makeHarness(2);
    h1.host.addPlayer('p1', 'Alice');
    assert(h1.list.latest?.length === 1, 'Host creates room with 1 player');
    h1.host.addPlayer('p2', 'Bob');
    assert(h1.list.latest?.length === 2, `Second player joins (${h1.list.latest.map(p => p.name).join(', ')})`);

    // --- Room full is enforced ---
    const full = h1.host.addPlayer('p3', 'Carol');
    assert(full.error === 'Room is full', 'Room capacity enforced');

    // --- Cannot start with too few players ---
    const solo = makeHarness(4);
    solo.host.addPlayer('s1', 'Solo');
    const tooFew = solo.host.startGame('s1');
    assert(!!tooFew.error, `Cannot start with 1 player (${tooFew.error})`);

    // --- Only host can start ---
    const notHost = h1.host.startGame('p2');
    assert(!!notHost.error, 'Only host can start the game');

    // --- Start game deals correctly ---
    const startRes = h1.host.startGame('p1');
    assert(startRes.ok === true, 'Host starts the game');
    assert(h1.host.discardPile.length === 1, 'Initial discard pile has 1 card');
    assert(!Engine.SPECIAL_CARDS.includes(h1.host.discardPile[0].rank), 'Starting card is not special');
    assert(h1.state.p1.players[h1.state.p1.myIndex].hand.length === 7, '2-player: host dealt 7 cards');
    assert(h1.state.p2.players[h1.state.p2.myIndex].hand.length === 7, '2-player: peer dealt 7 cards');

    // --- Anti-cheat: a player never receives another player's hand ---
    const p1View = h1.state.p1;
    const otherIdx = p1View.myIndex === 0 ? 1 : 0;
    assert(p1View.players[otherIdx].hand === undefined, 'Anti-cheat: host cannot see peer hand');
    assert(p1View.players[otherIdx].handCount === 7, 'Opponent hand count still visible (7)');

    // --- Invalid actions are ignored ---
    const notYourTurnId = h1.host.players[(h1.host.currentTurn + 1) % 2].id;
    const beforeTop = h1.host.discardPile.length;
    h1.host.handleAction(notYourTurnId, 'drawCard', {});
    assert(h1.host.discardPile.length === beforeTop, 'Out-of-turn action ignored');

    const curId0 = h1.host.players[h1.host.currentTurn].id;
    const handLenBefore = h1.host.players[h1.host.currentTurn].hand.length;
    h1.host.handleAction(curId0, 'playCard', { cardIndex: 999 });
    assert(h1.host.players[h1.host.currentTurn].hand.length === handLenBefore, 'Invalid card index ignored');

    // --- Full 2-player game to completion ---
    const turns = playToCompletion(h1.host, h1.state, ['p1', 'p2']);
    assert(h1.host.gameOver, `2-player game reaches game over (${turns} turns)`);
    const winnerP = h1.host.players.find(p => p.hand.length === 0);
    assert(!!winnerP, 'Winner has an empty hand');
    assert(!!(h1.over.p1 || h1.over.p2), `gameOver broadcast (winner: ${(h1.over.p1 || h1.over.p2)?.winner})`);

    // --- Card conservation across a full game ---
    let cardTotal = h1.host.deck.cards.length + h1.host.discardPile.length;
    h1.host.players.forEach(p => cardTotal += p.hand.length);
    assert(cardTotal === 52, `All 52 cards accounted for (got ${cardTotal})`);

    // --- 4-player deal (5 cards each) ---
    const h4 = makeHarness(4);
    ['a', 'b', 'c', 'd'].forEach((id, i) => h4.host.addPlayer(id, 'P' + i));
    h4.host.startGame('a');
    const all5 = ['a', 'b', 'c', 'd'].every(id => h4.state[id].players[h4.state[id].myIndex].hand.length === 5);
    assert(all5, '4-player: everyone dealt 5 cards');
    const t4 = playToCompletion(h4.host, h4.state, ['a', 'b', 'c', 'd']);
    assert(h4.host.gameOver, `4-player game reaches game over (${t4} turns)`);

    // --- Disconnect handling: opponent leaves mid-game → remaining player wins ---
    const hd = makeHarness(2);
    hd.host.addPlayer('x', 'Xavier');
    hd.host.addPlayer('y', 'Yolanda');
    hd.host.startGame('x');
    hd.host.removePlayer('y');
    assert(hd.host.gameOver, 'Game ends when only one player remains');
    assert(hd.over.x?.winner === 'Xavier', `Remaining player wins on disconnect (${hd.over.x?.winner})`);
    assert(/disconnect/i.test(hd.over.x?.reason || ''), `Win reason cites disconnect ("${hd.over.x?.reason}")`);

    // --- Lobby disconnect (before game start) just removes the player ---
    const hl = makeHarness(3);
    hl.host.addPlayer('m', 'Mia');
    hl.host.addPlayer('n', 'Noah');
    hl.host.removePlayer('n');
    assert(hl.list.latest.length === 1, 'Leaving the lobby pre-game removes the player');
    assert(!hl.host.gameOver, 'Lobby leave does not end a non-started game');

    // --- Name sanitization ---
    assert(Engine.sanitizeName('<script>Bob') === 'Bob', 'Name sanitization strips HTML tags');
    assert(Engine.sanitizeName('Bob<b>!!') === 'Bob', 'Name sanitization strips tags and symbols');
    assert(Engine.sanitizeName('') === 'Player', 'Empty name falls back to "Player"');
}

// ==================== MAIN ====================
async function main() {
    console.log('🎴 Crazy 8s — Full Test Suite (serverless / P2P)\n');

    runUnitTests();
    runPveTests();
    runEngineTests();

    section('FINAL RESULTS');
    console.log(`  Passed: ${totalPassed}`);
    console.log(`  Failed: ${totalFailed}`);
    console.log(totalFailed === 0 ? '\n  ✅ ALL TESTS PASSED!' : '\n  ❌ SOME TESTS FAILED!');
    console.log('='.repeat(60));

    process.exit(totalFailed === 0 ? 0 : 1);
}

main();
