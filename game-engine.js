/**
 * Crazy 8s — Shared Game Engine v3.0
 *
 * Host-authoritative multiplayer rules, used in two places:
 *  - Browser: the room host runs this engine and relays state to peers (P2P)
 *  - Node: the test suite drives it directly
 *
 * The engine is transport-agnostic: it emits events through the `send`
 * callback and never touches the network itself.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.Crazy8Engine = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
    const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    const SPECIAL_CARDS = ['8', '2', '7', 'J'];

    const RULES = {
        CARDS_PER_PLAYER: 5,
        CARDS_PER_PLAYER_TWO_PLAYER: 7,
        MIN_PLAYERS: 2,
        MAX_PLAYERS: 7,
        MAX_NAME_LENGTH: 50
    };

    class Card {
        constructor(suit, rank) {
            this.suit = suit;
            this.rank = rank;
            this.id = `${rank}-${suit}`;
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

    function sanitizeName(name) {
        if (typeof name !== 'string') return 'Player';
        return name
            .substring(0, RULES.MAX_NAME_LENGTH)
            .replace(/<[^>]*>/g, '')
            .replace(/[^\w\s-]/g, '')
            .trim() || 'Player';
    }

    class HostGame {
        /**
         * @param {Object} opts
         * @param {number} [opts.maxPlayers]
         * @param {(playerId: string, event: string, data: any) => void} opts.send
         */
        constructor({ maxPlayers = 4, send }) {
            this.maxPlayers = Math.min(Math.max(parseInt(maxPlayers) || 4, RULES.MIN_PLAYERS), RULES.MAX_PLAYERS);
            this.send = send;
            this.players = [];
            this.deck = new Deck();
            this.discardPile = [];
            this.currentTurn = 0;
            this.direction = 1;
            this.drawPenalty = 0;
            this.gameForcedSuit = null;
            this.gameStarted = false;
            this.gameOver = false;
        }

        // ---------- Messaging ----------

        broadcast(event, data) {
            this.players.forEach(p => {
                if (!p.disconnected) this.send(p.id, event, data);
            });
        }

        broadcastPlayerList() {
            this.broadcast('playerList', this.players.map(p => ({ id: p.id, name: p.name })));
        }

        broadcastState() {
            this.players.forEach((player, index) => {
                if (player.disconnected) return;
                this.send(player.id, 'gameState', {
                    discardPile: this.discardPile,
                    currentTurn: this.currentTurn,
                    gameForcedSuit: this.gameForcedSuit,
                    drawPenalty: this.drawPenalty,
                    deckCount: this.deck.cards.length,
                    players: this.players.map((p, i) => ({
                        id: p.id,
                        name: p.name,
                        handCount: p.hand.length,
                        // Anti-cheat: each player only receives their own hand
                        hand: (i === index) ? p.hand : undefined
                    })),
                    myIndex: index
                });
            });
        }

        // ---------- Lobby ----------

        addPlayer(id, name) {
            if (this.gameStarted) return { error: 'Game already started' };
            if (this.players.length >= this.maxPlayers) return { error: 'Room is full' };
            if (this.players.some(p => p.id === id)) return { error: 'Already joined' };
            this.players.push({ id, name: sanitizeName(name), hand: [], disconnected: false });
            this.broadcastPlayerList();
            return { ok: true };
        }

        removePlayer(id) {
            const idx = this.players.findIndex(p => p.id === id);
            if (idx === -1) return;
            const player = this.players[idx];

            if (!this.gameStarted) {
                this.players.splice(idx, 1);
                this.broadcast('playerLeft', { name: player.name });
                this.broadcastPlayerList();
                return;
            }

            if (player.disconnected) return;
            player.disconnected = true;
            this.broadcast('playerDisconnected', { name: player.name });

            if (this.gameOver) return;

            const connected = this.players.filter(p => !p.disconnected);
            if (connected.length <= 1) {
                if (connected.length === 1) this.endGame(connected[0], 'All other players disconnected');
                return;
            }

            if (this.currentTurn === idx) {
                this.advanceTurn(false);
            }
            this.broadcastState();
        }

        // ---------- Game flow ----------

        startGame(byId) {
            if (this.gameStarted) return { error: 'Game already started' };
            if (this.players[0]?.id !== byId) return { error: 'Only the host can start the game' };
            if (this.players.length < RULES.MIN_PLAYERS) {
                return { error: `Need at least ${RULES.MIN_PLAYERS} players to start` };
            }

            this.gameStarted = true;
            this.deck.reset();
            this.discardPile = [];

            const cardsPerPlayer = this.players.length === 2
                ? RULES.CARDS_PER_PLAYER_TWO_PLAYER
                : RULES.CARDS_PER_PLAYER;

            this.players.forEach(p => { p.hand = this.drawFromDeck(cardsPerPlayer); });

            // Starting card must not be a special card
            let startCard = this.deck.deal();
            while (SPECIAL_CARDS.includes(startCard.rank)) {
                this.deck.cards.unshift(startCard);
                this.deck.shuffle();
                startCard = this.deck.deal();
            }
            this.discardPile.push(startCard);

            this.broadcast('gameStarted');
            this.broadcastState();
            return { ok: true };
        }

        endGame(winner, reason) {
            this.gameOver = true;
            this.broadcast('gameOver', reason ? { winner: winner.name, reason } : { winner: winner.name });
        }

        // ---------- Rules ----------

        validateMove(card) {
            if (!card) return false;
            if (this.drawPenalty > 0) return card.rank === '2';
            const top = this.discardPile[this.discardPile.length - 1];
            if (!top) return true;
            const suit = this.gameForcedSuit || top.suit;
            return (card.rank === '8' || card.suit === suit || card.rank === top.rank);
        }

        advanceTurn(skip = false) {
            const len = this.players.length;
            if (len === 0) return;

            let next = this.currentTurn + this.direction;
            if (skip) next += this.direction;
            this.currentTurn = ((next % len) + len) % len;

            // Skip disconnected players
            let attempts = 0;
            while (this.players[this.currentTurn]?.disconnected && attempts < len) {
                next = this.currentTurn + this.direction;
                this.currentTurn = ((next % len) + len) % len;
                attempts++;
            }
        }

        refillDeck() {
            if (this.discardPile.length <= 1) return;
            const top = this.discardPile.pop();
            this.deck.cards = this.discardPile;
            this.discardPile = [top];
            this.deck.shuffle();
        }

        drawFromDeck(count) {
            const drawn = [];
            for (let i = 0; i < count; i++) {
                if (this.deck.isEmpty) this.refillDeck();
                if (!this.deck.isEmpty) drawn.push(this.deck.deal());
            }
            return drawn;
        }

        // ---------- Player actions ----------

        handleAction(id, action, data = {}) {
            if (!this.gameStarted || this.gameOver) return;
            switch (action) {
                case 'playCard': return this.playCard(id, data.cardIndex);
                case 'drawCard': return this.drawCard(id);
                case 'pickSuit': return this.pickSuit(id, data.suit);
            }
        }

        playCard(id, cardIndex) {
            if (typeof cardIndex !== 'number' || cardIndex < 0) return;

            const playerIdx = this.players.findIndex(p => p.id === id);
            if (playerIdx === -1 || playerIdx !== this.currentTurn) return;

            const player = this.players[playerIdx];
            if (cardIndex >= player.hand.length) return;

            const card = player.hand[cardIndex];
            if (!this.validateMove(card)) return;

            player.hand.splice(cardIndex, 1);
            this.discardPile.push(card);
            this.gameForcedSuit = null;

            let skip = false;
            if (card.rank === '2') this.drawPenalty += 2;
            else if (card.rank === '7') skip = true;
            else if (card.rank === 'J') this.direction *= -1;

            if (player.hand.length === 0) {
                this.endGame(player);
                return;
            }

            // An 8 waits for the suit choice before the turn advances
            if (card.rank === '8') {
                this.broadcastState();
                return;
            }

            this.advanceTurn(skip);
            this.broadcastState();
        }

        pickSuit(id, suit) {
            if (!suit || !SUITS.includes(suit)) return;
            if (this.players[this.currentTurn]?.id !== id) return;

            this.gameForcedSuit = suit;
            this.advanceTurn(false);
            this.broadcastState();
        }

        drawCard(id) {
            if (this.players[this.currentTurn]?.id !== id) return;

            const player = this.players[this.currentTurn];
            if (this.drawPenalty > 0) {
                player.hand.push(...this.drawFromDeck(this.drawPenalty));
                this.drawPenalty = 0;
            } else {
                player.hand.push(...this.drawFromDeck(1));
            }

            this.advanceTurn(false);
            this.broadcastState();
        }
    }

    return { SUITS, RANKS, SPECIAL_CARDS, RULES, Card, Deck, HostGame, sanitizeName };
});
