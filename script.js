console.log("Crazy 8 Client v3.0 Loaded (serverless / P2P)");

// ==================== CONSTANTS ====================
const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SYMBOLS = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };
const SPECIAL_CARDS = ['8', '2', '7', 'J'];
const BOT_NAMES = ['Hal', 'Chip', 'Data', 'Robo', 'Spark', 'Wire', 'Glitch', 'Byte'];

// PeerJS namespace prefix — keeps our room codes from colliding with other
// apps on the shared public PeerJS broker.
const PEER_PREFIX = 'khasino-crazy8-';
const PEER_CONNECT_TIMEOUT_MS = 12000;
// WebRTC doesn't reliably signal an abruptly-closed tab, so host & peers
// exchange heartbeats and treat silence past the timeout as a disconnect.
const HEARTBEAT_INTERVAL_MS = 3000;
const PEER_TIMEOUT_MS = 10000;

const CONFIG = {
    CARDS_PER_PLAYER: 5,
    CARDS_PER_PLAYER_TWO_PLAYER: 7,
    CARD_ANIMATION_MS: 450,
    DRAW_ANIMATION_MS: 400,
    DEAL_STAGGER_MS: 70,
    BOT_THINK_MS: 900,
    MESSAGE_DISPLAY_MS: 2500,
    SHAKE_DURATION_MS: 500,
    MAX_VISIBLE_DISCARD: 5,
    MAX_MINI_CARDS: 5,
    CONFETTI_PIECES: 80,
    CONFETTI_LIFETIME_MS: 6000
};

// ==================== DATA CLASSES ====================

class Card {
    constructor(suit, rank) {
        this.suit = suit;
        this.rank = rank;
        this.id = `${rank}-${suit}`;
    }
    get color() { return (this.suit === 'hearts' || this.suit === 'diamonds') ? 'red' : 'black'; }
    get symbol() { return SYMBOLS[this.suit]; }
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

class Player {
    constructor(name, type = 'bot', id = null) {
        this.name = name;
        this.type = type;
        this.id = id;
        this.hand = [];
        this.handCount = 0;
    }
}

// ==================== GAME CLASS ====================

class Game {
    constructor() {
        // Game State
        this.deck = new Deck();
        this.players = [];
        this.discardPile = [];
        this.currentTurn = 0;
        this.direction = 1;
        this.drawPenalty = 0;
        this.gameForcedSuit = null;
        this.gameOver = false;

        // Animation tracking (so re-renders only animate what changed)
        this.prevHandIds = new Set();
        this.prevDiscardLen = 0;
        this.initialDealPending = false;

        // Networking (P2P via PeerJS)
        this.gameMode = 'pve';
        this.peer = null;         // our PeerJS instance
        this.isHost = false;      // host runs the authoritative engine
        this.engine = null;       // Crazy8Engine.HostGame (host only)
        this.connections = {};    // host only: peerId -> DataConnection
        this.hostConn = null;     // peer only: connection to the host
        this.heartbeatTimer = null;
        this.lastSeen = {};       // host only: peerId -> last-heard timestamp
        this.lastHostSeen = 0;    // peer only: last time we heard from the host
        this.onlineDeckCount = null;
        this.roomId = null;
        this.myPlayerId = null;

        // Cache DOM references
        this.dom = this.cacheDomElements();
        this.bindEvents();
    }

    // ==================== DOM & EVENTS ====================

    cacheDomElements() {
        return {
            landingPage: document.getElementById('landing-page'),
            waitingRoomModal: document.getElementById('waiting-room-modal'),
            landingCreateBtn: document.getElementById('landing-create-btn'),
            landingJoinBtn: document.getElementById('landing-join-btn'),
            landingPveBtn: document.getElementById('landing-pve-btn'),
            startOnlineBtn: document.getElementById('start-online-game-btn'),
            copyRoomBtn: document.getElementById('copy-room-btn'),
            waitingStatus: document.getElementById('waiting-status'),
            landingPlayerName: document.getElementById('landing-player-name'),
            landingPlayerCount: document.getElementById('landing-player-count'),
            landingRoomInput: document.getElementById('landing-room-input'),
            displayRoomId: document.getElementById('display-room-id'),
            playerListDisplay: document.getElementById('player-list-display'),
            opponentsContainer: document.getElementById('opponents-container'),
            playerHand: document.getElementById('player-hand'),
            playerAvatar: document.getElementById('current-player-avatar'),
            playerName: document.getElementById('current-player-name'),
            discardPile: document.getElementById('discard-pile'),
            drawPile: document.getElementById('draw-pile'),
            turnIndicator: document.getElementById('turn-indicator'),
            playerCountDisplay: document.getElementById('player-card-count'),
            suitModal: document.getElementById('suit-modal'),
            suitOptions: document.querySelector('.suit-options'),
            suitIndicator: document.getElementById('suit-indicator'),
            currentSuitDisplay: document.getElementById('current-suit-display'),
            gameOverModal: document.getElementById('game-over-modal'),
            winnerText: document.getElementById('winner-text'),
            playAgainBtn: document.getElementById('play-again-btn'),
            restartBtn: document.getElementById('restart-btn'),
            messageArea: document.getElementById('message-area')
        };
    }

    bindEvents() {
        const { dom } = this;

        // PVE
        dom.landingPveBtn.addEventListener('click', () => {
            this.startPVE(this.getPlayerCount(), this.getPlayerNameInput());
        });

        // Online - Create room (become host) / Join a friend's room (become peer)
        dom.landingCreateBtn.addEventListener('click', () => {
            this.startAsHost(this.getPlayerCount());
        });

        dom.landingJoinBtn.addEventListener('click', () => {
            this.joinAsPeer(dom.landingRoomInput.value);
        });

        dom.startOnlineBtn.addEventListener('click', () => this.startOnlineGame());

        dom.copyRoomBtn.addEventListener('click', () => this.copyRoomCode());

        // Gameplay
        dom.drawPile.addEventListener('click', () => this.handleDrawClick());

        dom.suitOptions.addEventListener('click', (e) => {
            if (!e.target.classList.contains('suit-btn')) return;
            const suit = e.target.dataset.suit;
            if (this.gameMode === 'pve') {
                this.resolveEightPVE(suit);
            } else {
                this.sendAction('pickSuit', { suit });
                dom.suitModal.classList.add('hidden');
            }
        });

        // Restart
        dom.playAgainBtn.addEventListener('click', () => window.location.reload());
        dom.restartBtn.addEventListener('click', () => window.location.reload());
    }

    // ==================== INPUT HELPERS ====================

    getPlayerNameInput() {
        return this.dom.landingPlayerName.value.trim() || 'Player';
    }

    getPlayerCount() {
        return parseInt(this.dom.landingPlayerCount.value) || 2;
    }

    getMyPlayer() {
        if (this.gameMode === 'pve') return this.players[0];
        return this.players.find(p => p.id === this.myPlayerId) ?? null;
    }

    isMyTurn() {
        if (this.gameMode === 'pve') return this.currentTurn === 0;
        return this.players[this.currentTurn]?.id === this.myPlayerId;
    }

    getTopCard() {
        return this.discardPile[this.discardPile.length - 1] ?? null;
    }

    // ==================== ONLINE (P2P via PeerJS) ====================

    ensurePeerLibrary() {
        if (window.Peer && window.Crazy8Engine) return true;
        alert("Online play unavailable: the peer-to-peer library failed to load.\n\nCheck your internet connection and reload the page. You can still Play vs Computer.");
        return false;
    }

    generateRoomCode() {
        // 5 chars, no ambiguous 0/O/1/I/L
        const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
        let code = '';
        for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
        return code;
    }

    handlePeerError(err) {
        console.error('PeerJS error:', err);
        const type = err?.type;
        if (type === 'peer-unavailable') {
            alert(`Room "${this.roomId}" was not found.\n\nCheck the code with your host and try again.`);
        } else if (type === 'unavailable-id') {
            // Rare room-code collision on the broker — retry with a fresh code
            this.showMessage('Room code taken, retrying…', 2000);
            this.teardownPeer();
            this.startAsHost(this.pendingMaxPlayers || this.getPlayerCount());
        } else if (type === 'network' || type === 'server-error' || type === 'socket-error') {
            alert('Could not reach the peer-to-peer network. Check your connection and try again.');
        } else {
            this.showMessage('Connection error. Please try again.', 3000);
        }
    }

    teardownPeer() {
        this.stopHeartbeat();
        try { this.peer?.destroy(); } catch (_) { /* noop */ }
        this.peer = null;
        this.connections = {};
        this.hostConn = null;
        this.engine = null;
        this.lastSeen = {};
    }

    stopHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }

    // Host: ping each peer, and drop any that have gone silent past the timeout
    startHostHeartbeat() {
        this.stopHeartbeat();
        this.heartbeatTimer = setInterval(() => {
            const now = Date.now();
            Object.keys(this.connections).forEach(pid => {
                const conn = this.connections[pid];
                if (conn && conn.open) conn.send({ type: 'heartbeat' });
                const seen = this.lastSeen[pid] ?? now;
                if (now - seen > PEER_TIMEOUT_MS) {
                    delete this.connections[pid];
                    this.lastSeen[pid] = undefined;
                    this.engine?.removePlayer(pid);
                }
            });
        }, HEARTBEAT_INTERVAL_MS);
    }

    // Peer: ping the host, and detect if the host itself goes silent
    startPeerHeartbeat() {
        this.stopHeartbeat();
        this.lastHostSeen = Date.now();
        this.heartbeatTimer = setInterval(() => {
            if (this.hostConn && this.hostConn.open) this.hostConn.send({ type: 'heartbeat' });
            if (Date.now() - this.lastHostSeen > PEER_TIMEOUT_MS) {
                this.stopHeartbeat();
                if (!this.gameOver) {
                    this.showMessage('Host disconnected — game ended', 4000);
                    this.showGameOver('Host disconnected', false);
                }
            }
        }, HEARTBEAT_INTERVAL_MS);
    }

    // ---------- Host ----------

    startAsHost(maxPlayers) {
        if (!this.ensurePeerLibrary()) return;
        this.teardownPeer();

        this.isHost = true;
        this.pendingMaxPlayers = maxPlayers;
        this.roomId = this.generateRoomCode();
        this.peer = new Peer(PEER_PREFIX + this.roomId);

        this.peer.on('open', (id) => {
            this.myPlayerId = id;
            this.engine = new Crazy8Engine.HostGame({
                maxPlayers,
                send: (pid, event, data) => this.routeFromHost(pid, event, data)
            });
            this.engine.addPlayer(id, this.getPlayerNameInput());
            this.startHostHeartbeat();
            this.enterWaitingRoom();
        });

        this.peer.on('connection', (conn) => this.setupHostConnection(conn));
        this.peer.on('error', (err) => this.handlePeerError(err));
    }

    setupHostConnection(conn) {
        conn.on('open', () => {
            this.connections[conn.peer] = conn;
            this.lastSeen[conn.peer] = Date.now();
        });

        conn.on('data', (msg) => {
            if (!msg || typeof msg !== 'object' || !this.engine) return;
            this.lastSeen[conn.peer] = Date.now();
            if (msg.type === 'heartbeat') {
                // liveness only — timestamp already refreshed above
            } else if (msg.type === 'join') {
                const res = this.engine.addPlayer(conn.peer, msg.name);
                if (res.error) this.routeToPeer(conn.peer, 'error', res.error);
            } else if (msg.type === 'action') {
                this.engine.handleAction(conn.peer, msg.action, msg.data);
            }
        });

        conn.on('close', () => {
            delete this.connections[conn.peer];
            this.engine?.removePlayer(conn.peer);
        });
        conn.on('error', () => {
            delete this.connections[conn.peer];
            this.engine?.removePlayer(conn.peer);
        });
    }

    // Engine 'send' callback: deliver locally if it's the host, else over WebRTC
    routeFromHost(playerId, event, data) {
        if (playerId === this.myPlayerId) this.handleNetworkEvent(event, data);
        else this.routeToPeer(playerId, event, data);
    }

    routeToPeer(playerId, event, data) {
        const conn = this.connections[playerId];
        if (conn && conn.open) conn.send({ event, data });
    }

    startOnlineGame() {
        if (!this.isHost || !this.engine) return;
        const res = this.engine.startGame(this.myPlayerId);
        if (res.error) this.showMessage(res.error, 2500);
    }

    // ---------- Peer (guest) ----------

    joinAsPeer(rawCode) {
        if (!this.ensurePeerLibrary()) return;
        const code = (rawCode || '').trim().toLowerCase();
        if (!code) { this.showMessage('Enter a room code first', 2000); return; }

        this.teardownPeer();
        this.isHost = false;
        this.roomId = code;
        this.peer = new Peer();

        this.peer.on('open', () => {
            this.myPlayerId = this.peer.id;
            const conn = this.peer.connect(PEER_PREFIX + code, { reliable: true });
            this.hostConn = conn;

            let opened = false;
            conn.on('open', () => {
                opened = true;
                conn.send({ type: 'join', name: this.getPlayerNameInput() });
                this.startPeerHeartbeat();
                this.enterWaitingRoom();
            });
            conn.on('data', (msg) => {
                this.lastHostSeen = Date.now();
                if (msg && msg.event) this.handleNetworkEvent(msg.event, msg.data);
            });
            conn.on('close', () => this.showMessage('Disconnected from host', 3000));
            conn.on('error', () => {});

            setTimeout(() => {
                if (!opened) {
                    alert(`Could not connect to room "${code}".\n\nMake sure the host still has the game open and the code is correct.`);
                    this.teardownPeer();
                }
            }, PEER_CONNECT_TIMEOUT_MS);
        });

        this.peer.on('error', (err) => this.handlePeerError(err));
    }

    // ---------- Shared ----------

    // Both host (locally) and peers (over the wire) funnel events through here
    handleNetworkEvent(event, data) {
        switch (event) {
            case 'playerList': return this.renderPlayerList(data);
            case 'gameStarted': return this.onGameStarted();
            case 'gameState': return this.syncState(data);
            case 'gameOver': return this.onGameOver(data);
            case 'playerDisconnected': return this.showMessage(`${data.name} disconnected`);
            case 'playerLeft': return this.showMessage(`${data.name} left the room`);
            case 'error': return this.showMessage(typeof data === 'string' ? data : 'Error', 3000);
        }
    }

    sendAction(action, data = {}) {
        if (this.isHost) {
            this.engine?.handleAction(this.myPlayerId, action, data);
        } else if (this.hostConn && this.hostConn.open) {
            this.hostConn.send({ type: 'action', action, data });
        }
    }

    renderPlayerList(list) {
        this.dom.playerListDisplay.innerHTML = list
            .map(p => `<div>${this.escapeHtml(p.name)}${p.id === this.myPlayerId ? ' <span class="you-tag">(You)</span>' : ''}</div>`)
            .join('');

        if (this.isHost) {
            const ready = list.length >= 2;
            this.dom.startOnlineBtn.classList.toggle('hidden', !ready);
            this.dom.waitingStatus.textContent = ready
                ? 'Ready! Start when everyone has joined.'
                : 'Waiting for players to join…';
        } else {
            this.dom.startOnlineBtn.classList.add('hidden');
            this.dom.waitingStatus.textContent = 'Waiting for the host to start…';
        }
    }

    onGameStarted() {
        this.gameMode = 'online';
        this.gameOver = false;
        this.initialDealPending = true;
        this.prevHandIds = new Set();
        this.prevDiscardLen = 0;
        this.dom.waitingRoomModal.classList.add('hidden');
        this.dom.landingPage.classList.add('hidden');
    }

    onGameOver({ winner, reason }) {
        const message = reason ? `${winner} Wins! (${reason})` : `${winner} Wins!`;
        const iWon = this.getMyPlayer()?.name === winner;
        this.showGameOver(iWon ? `🎉 ${message} 🎉` : message, iWon);
    }

    enterWaitingRoom() {
        this.dom.landingPage.classList.add('hidden');
        this.dom.waitingRoomModal.classList.remove('hidden');
        this.dom.displayRoomId.textContent = this.roomId;
    }

    copyRoomCode() {
        if (!this.roomId) return;
        const done = () => this.showMessage('Room code copied!', 1500);
        if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(this.roomId).then(done).catch(() => {});
        }
    }

    escapeHtml(str) {
        return String(str).replace(/[&<>"']/g, c =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    syncState(state) {
        const myIndex = state.myIndex ?? state.players.findIndex(p => p.id === this.myPlayerId);

        this.players = state.players.map((p) => {
            const player = new Player(p.name, 'online', p.id);
            player.handCount = p.handCount || 0;
            if (p.hand?.length > 0) {
                player.hand = p.hand.map(c => new Card(c.suit, c.rank));
            }
            return player;
        });

        this.discardPile = state.discardPile.map(c => new Card(c.suit, c.rank));
        this.currentTurn = state.currentTurn;
        this.gameForcedSuit = state.gameForcedSuit;
        this.drawPenalty = state.drawPenalty;
        this.onlineDeckCount = state.deckCount ?? null;

        // Show suit picker if it's my turn and top card is an 8 awaiting suit choice
        const top = this.getTopCard();
        const showSuitPicker = myIndex !== -1 && this.currentTurn === myIndex && top?.rank === '8' && !this.gameForcedSuit;
        this.dom.suitModal.classList.toggle('hidden', !showSuitPicker);

        this.updateUI();
    }

    // ==================== UI RENDERING ====================

    updateUI() {
        this.renderDiscardPile();
        this.renderSuitIndicator();
        this.renderOpponents();
        this.renderMyHand();
        this.renderTurnIndicator();
        this.renderDeckCount();
        this.highlightPlayableCards();
        this.updateDrawPileState();
    }

    // Deterministic pseudo-random per card so the discard scatter doesn't jitter on re-renders
    cardScatter(card) {
        let h = 0;
        for (const ch of card.id) h = ((h * 31) + ch.charCodeAt(0)) | 0;
        const unit = (seed) => (((h ^ seed) % 1000) / 1000) - 0.5;
        return {
            rotation: unit(0x9e37) * 30,
            offsetX: unit(0x85eb) * 20,
            offsetY: unit(0xc2b2) * 10
        };
    }

    renderDiscardPile() {
        this.dom.discardPile.innerHTML = '';
        const startIdx = Math.max(0, this.discardPile.length - CONFIG.MAX_VISIBLE_DISCARD);
        const discardGrew = this.discardPile.length > this.prevDiscardLen;

        for (let i = startIdx; i < this.discardPile.length; i++) {
            const cardEl = this.createCardElement(this.discardPile[i]);
            const isTop = (i === this.discardPile.length - 1);

            if (isTop) {
                cardEl.style.zIndex = 100;
                cardEl.classList.add('top-card');
                if (discardGrew) cardEl.classList.add('drop-in');
            } else {
                const { rotation, offsetX, offsetY } = this.cardScatter(this.discardPile[i]);
                cardEl.style.transform = `rotate(${rotation}deg) translate(${offsetX}px, ${offsetY}px)`;
                cardEl.style.zIndex = i - startIdx;
            }

            cardEl.style.position = 'absolute';
            this.dom.discardPile.appendChild(cardEl);
        }

        this.prevDiscardLen = this.discardPile.length;
    }

    renderSuitIndicator() {
        if (this.gameForcedSuit) {
            this.dom.suitIndicator.classList.remove('hidden');
            const symbol = SYMBOLS[this.gameForcedSuit] || '';
            this.dom.currentSuitDisplay.textContent = `${symbol} ${this.gameForcedSuit}`;
            this.dom.currentSuitDisplay.className = ['hearts', 'diamonds'].includes(this.gameForcedSuit) ? 'red' : 'black';
        } else {
            this.dom.suitIndicator.classList.add('hidden');
        }
    }

    renderOpponents() {
        this.dom.opponentsContainer.innerHTML = '';

        this.players.forEach((p, i) => {
            const isMe = this.gameMode === 'pve' ? i === 0 : p.id === this.myPlayerId;
            if (isMe) return;

            const cardCount = p.handCount || p.hand?.length || 0;
            const visualCount = Math.min(cardCount, CONFIG.MAX_MINI_CARDS);
            const miniCards = '<div class="mini-card-back"></div>'.repeat(visualCount);
            const lastCardWarning = cardCount === 1 ? '<div class="last-card-badge">LAST CARD!</div>' : '';

            const el = document.createElement('div');
            el.className = `opponent-card ${i === this.currentTurn ? 'active-turn' : ''}`;
            el.dataset.playerIndex = i;
            el.innerHTML = `
                <div class="avatar robot">👤</div>
                <div class="name">${p.name}</div>
                <div class="card-count">${cardCount} Card${cardCount !== 1 ? 's' : ''}</div>
                ${lastCardWarning}
                <div class="opponent-hand-mini">${miniCards}</div>
            `;
            this.dom.opponentsContainer.appendChild(el);
        });
    }

    renderMyHand() {
        const myPlayer = this.getMyPlayer();
        if (!myPlayer) return;

        this.dom.playerName.textContent = myPlayer.name;
        this.dom.playerHand.innerHTML = '';

        myPlayer.hand.forEach((card, index) => {
            const el = this.createCardElement(card);
            el.dataset.index = index;
            el.onclick = () => this.handleCardClick(index);

            if (this.initialDealPending) {
                el.classList.add('deal-anim');
                el.style.animationDelay = `${index * CONFIG.DEAL_STAGGER_MS}ms`;
            } else if (!this.prevHandIds.has(card.id)) {
                el.classList.add('card-enter');
            }
            this.dom.playerHand.appendChild(el);
        });

        this.prevHandIds = new Set(myPlayer.hand.map(c => c.id));
        this.initialDealPending = false;
        this.dom.playerCountDisplay.textContent = myPlayer.hand.length;
    }

    renderTurnIndicator() {
        const currentPlayer = this.players[this.currentTurn];
        if (!currentPlayer) return;

        if (this.isMyTurn()) {
            let text = '🟢 Your Turn';
            if (this.drawPenalty > 0) text += ` — Play a 2 or tap deck to draw ${this.drawPenalty}`;
            this.dom.turnIndicator.textContent = text;
            this.dom.turnIndicator.style.color = '#ffd700';
            this.dom.turnIndicator.classList.add('pulse-turn');
        } else {
            this.dom.turnIndicator.textContent = `${currentPlayer.name}'s Turn`;
            this.dom.turnIndicator.style.color = '#fff';
            this.dom.turnIndicator.classList.remove('pulse-turn');
        }
    }

    renderDeckCount() {
        const count = this.gameMode === 'pve' ? this.deck.cards.length : this.onlineDeckCount;
        let label = this.dom.drawPile.querySelector('.deck-count-label');
        if (!label) {
            label = document.createElement('div');
            label.className = 'deck-count-label';
            this.dom.drawPile.appendChild(label);
        }
        label.textContent = (count === null || count === undefined) ? '' : `${count}`;
    }

    highlightPlayableCards() {
        if (!this.isMyTurn() || this.gameOver) return;
        const myPlayer = this.getMyPlayer();
        if (!myPlayer) return;

        const handEls = this.dom.playerHand.children;
        myPlayer.hand.forEach((card, i) => {
            if (handEls[i]) {
                const isValid = this.gameMode === 'pve' ? this.isValidMovePVE(card) : this.isValidMoveOnline(card);
                handEls[i].classList.toggle('playable', isValid);
                handEls[i].classList.toggle('unplayable', !isValid);
            }
        });
    }

    isValidMoveOnline(card) {
        if (this.drawPenalty > 0) return card.rank === '2';
        const top = this.getTopCard();
        if (!top) return true;
        const suit = this.gameForcedSuit || top.suit;
        return card.rank === '8' || card.suit === suit || card.rank === top.rank;
    }

    updateDrawPileState() {
        if (this.isMyTurn() && !this.gameOver) {
            this.dom.drawPile.classList.add('your-turn-draw');
        } else {
            this.dom.drawPile.classList.remove('your-turn-draw');
        }
    }

    // ==================== UI HELPERS ====================

    createCardElement(card) {
        const el = document.createElement('div');
        el.className = `card ${card.color}`;
        el.innerHTML = `
            <div class="card-top">${card.rank}<span>${card.symbol}</span></div>
            <div class="card-center">${card.symbol}</div>
            <div class="card-bottom">${card.rank}<span>${card.symbol}</span></div>
        `;
        return el;
    }

    showMessage(text, duration = CONFIG.MESSAGE_DISPLAY_MS) {
        this.dom.messageArea.textContent = text;
        this.dom.messageArea.style.opacity = '1';
        setTimeout(() => { this.dom.messageArea.style.opacity = '0'; }, duration);
    }

    animatePlayCard(startEl, callback) {
        if (!startEl) { callback(); return; }

        const rect = startEl.getBoundingClientRect();
        const targetRect = this.dom.discardPile.getBoundingClientRect();

        const clone = startEl.cloneNode(true);
        clone.classList.add('flying-card');
        Object.assign(clone.style, {
            left: `${rect.left}px`,
            top: `${rect.top}px`,
            width: `${rect.width}px`,
            height: `${rect.height}px`,
            transform: 'none'
        });

        document.body.appendChild(clone);
        startEl.style.opacity = '0';
        clone.offsetHeight; // Force reflow

        const deltaX = (targetRect.left + targetRect.width / 2) - (rect.left + rect.width / 2);
        const deltaY = (targetRect.top + targetRect.height / 2) - (rect.top + rect.height / 2);
        const rotation = (Math.random() - 0.5) * 20;
        clone.style.transform = `translate(${deltaX}px, ${deltaY}px) rotate(${rotation}deg) scale(1.0)`;

        setTimeout(() => { clone.remove(); callback(); }, CONFIG.CARD_ANIMATION_MS);
    }

    animateDrawCard(callback) {
        const pileBack = this.dom.drawPile.querySelector('.card-back');
        if (!pileBack) { if (callback) callback(); return; }

        const rect = pileBack.getBoundingClientRect();
        const handRect = this.dom.playerHand.getBoundingClientRect();

        const clone = document.createElement('div');
        clone.className = 'card-back flying-card flying-fast';
        Object.assign(clone.style, {
            position: 'fixed',
            left: `${rect.left}px`,
            top: `${rect.top}px`,
            width: `${rect.width}px`,
            height: `${rect.height}px`
        });

        document.body.appendChild(clone);
        clone.offsetHeight; // Force reflow

        const deltaX = (handRect.left + handRect.width / 2) - (rect.left + rect.width / 2);
        const deltaY = (handRect.top + handRect.height / 2) - (rect.top + rect.height / 2);
        clone.style.transform = `translate(${deltaX}px, ${deltaY}px) scale(0.9)`;
        clone.style.opacity = '0.4';

        setTimeout(() => { clone.remove(); if (callback) callback(); }, CONFIG.DRAW_ANIMATION_MS);
    }

    animateCardFromOpponent(playerIndex, card, callback) {
        const source = this.dom.opponentsContainer.querySelector(`[data-player-index="${playerIndex}"]`);
        if (!source) { callback(); return; }

        const srcRect = source.getBoundingClientRect();
        const tgtRect = this.dom.discardPile.getBoundingClientRect();

        const clone = this.createCardElement(card);
        clone.classList.add('flying-card');
        const startLeft = srcRect.left + srcRect.width / 2 - tgtRect.width / 2;
        const startTop = srcRect.top + srcRect.height / 2 - tgtRect.height / 2;
        Object.assign(clone.style, {
            position: 'fixed',
            left: `${startLeft}px`,
            top: `${startTop}px`,
            width: `${tgtRect.width}px`,
            height: `${tgtRect.height}px`,
            margin: '0',
            transform: 'scale(0.4)',
            opacity: '0.5'
        });

        document.body.appendChild(clone);
        clone.offsetHeight; // Force reflow

        const deltaX = (tgtRect.left + tgtRect.width / 2) - (srcRect.left + srcRect.width / 2);
        const deltaY = (tgtRect.top + tgtRect.height / 2) - (srcRect.top + srcRect.height / 2);
        clone.style.transform = `translate(${deltaX}px, ${deltaY}px) scale(1)`;
        clone.style.opacity = '1';

        setTimeout(() => { clone.remove(); callback(); }, CONFIG.CARD_ANIMATION_MS);
    }

    showGameOver(message, celebrate = false) {
        this.gameOver = true;
        this.dom.winnerText.textContent = message;
        this.dom.gameOverModal.classList.remove('hidden');
        if (celebrate) this.spawnConfetti();
    }

    spawnConfetti() {
        const colors = ['#ffd700', '#ef4444', '#3b82f6', '#22c55e', '#a855f7', '#f97316'];
        for (let i = 0; i < CONFIG.CONFETTI_PIECES; i++) {
            const piece = document.createElement('div');
            piece.className = 'confetti-piece';
            piece.style.left = `${Math.random() * 100}vw`;
            piece.style.background = colors[i % colors.length];
            piece.style.animationDuration = `${2.5 + Math.random() * 2}s`;
            piece.style.animationDelay = `${Math.random() * 0.8}s`;
            document.body.appendChild(piece);
            setTimeout(() => piece.remove(), CONFIG.CONFETTI_LIFETIME_MS);
        }
    }

    // ==================== INTERACTION HANDLERS ====================

    handleDrawClick() {
        if (this.gameOver) return;

        if (this.gameMode === 'pve') {
            if (!this.isMyTurn()) return;
            if (this.drawPenalty > 0) this.resolvePVEPenalty(0);
            else this.humanDrawPVE();
        } else {
            if (!this.isMyTurn()) {
                this.showMessage("Wait for your turn!", 1200);
                return;
            }
            this.animateDrawCard(() => this.sendAction('drawCard'));
        }
    }

    handleCardClick(index) {
        if (this.gameOver) return;
        if (!this.isMyTurn()) {
            this.showMessage("Wait for your turn!", 1200);
            return;
        }

        if (this.gameMode === 'pve') {
            this.attemptPlayPVE(index);
        } else {
            const card = this.getMyPlayer()?.hand[index];
            if (!card) return;
            if (!this.isValidMoveOnline(card)) {
                this.rejectCard(index);
                return;
            }
            this.animatePlayCard(this.dom.playerHand.children[index], () => {
                this.sendAction('playCard', { cardIndex: index });
            });
        }
    }

    rejectCard(index) {
        const cardEl = this.dom.playerHand.children[index];
        if (!cardEl) return;
        cardEl.classList.add('shake');
        const reason = this.drawPenalty > 0 ? 'Must play a 2 or draw!' : 'Card doesn\'t match!';
        this.showMessage(reason, 1500);
        setTimeout(() => cardEl.classList.remove('shake'), CONFIG.SHAKE_DURATION_MS);
    }

    // ==================== PVE GAME LOGIC ====================

    startPVE(totalPlayers, playerName) {
        this.gameMode = 'pve';
        this.gameOver = false;
        this.gameForcedSuit = null;
        this.currentTurn = 0;
        this.direction = 1;
        this.drawPenalty = 0;
        this.players = [];
        this.discardPile = [];
        this.initialDealPending = true;
        this.prevHandIds = new Set();
        this.prevDiscardLen = 0;

        this.dom.landingPage.classList.add('hidden');
        this.deck.reset();

        // Create players
        this.players.push(new Player(playerName || 'You', 'human'));
        const shuffledBots = [...BOT_NAMES].sort(() => 0.5 - Math.random());
        for (let i = 1; i < totalPlayers; i++) {
            this.players.push(new Player(shuffledBots[i - 1] || `Bot ${i}`, 'bot'));
        }

        // Deal cards
        const cardsPerPlayer = totalPlayers === 2 ? CONFIG.CARDS_PER_PLAYER_TWO_PLAYER : CONFIG.CARDS_PER_PLAYER;
        this.players.forEach(p => {
            for (let i = 0; i < cardsPerPlayer; i++) p.hand.push(this.deck.deal());
        });

        // Starting card (no special cards)
        let startCard = this.deck.deal();
        while (SPECIAL_CARDS.includes(startCard.rank)) {
            this.deck.cards.unshift(startCard);
            this.deck.shuffle();
            startCard = this.deck.deal();
        }
        this.discardPile.push(startCard);

        this.updateUI();
        this.checkTurnPVE();
    }

    isValidMovePVE(card) {
        if (this.drawPenalty > 0) return card.rank === '2';
        const top = this.getTopCard();
        const effectiveSuit = this.gameForcedSuit || top.suit;
        return card.rank === '8' || card.suit === effectiveSuit || card.rank === top.rank;
    }

    checkTurnPVE() {
        if (!this.gameOver && this.players[this.currentTurn]?.type === 'bot') {
            this.botTurnPVE();
        }
    }

    attemptPlayPVE(cardIndex) {
        const player = this.players[0];
        const card = player.hand[cardIndex];

        if (this.isValidMovePVE(card)) {
            this.animatePlayCard(this.dom.playerHand.children[cardIndex], () => {
                player.hand.splice(cardIndex, 1);
                this.playCardPVE(card, 0);
            });
        } else {
            this.rejectCard(cardIndex);
        }
    }

    playCardPVE(card, playerIndex) {
        this.discardPile.push(card);
        this.gameForcedSuit = null;

        // Apply special effects
        let skip = false;
        if (card.rank === '2') this.drawPenalty += 2;
        if (card.rank === '7') skip = true;
        if (card.rank === 'J') this.direction *= -1;

        // Show bot action message
        if (playerIndex !== 0) {
            const name = this.players[playerIndex].name;
            let msg = `${name} plays ${card.rank}${SYMBOLS[card.suit]}`;
            if (card.rank === '2') msg += ' — Draw 2!';
            else if (card.rank === '7') msg += ' — Skip!';
            else if (card.rank === 'J') msg += ' — Reverse!';
            else if (card.rank === '8') msg += ' — Wild!';
            this.showMessage(msg, 1800);
        }

        // Check win
        if (this.players[playerIndex].hand.length === 0) {
            this.updateUI();
            const isHuman = this.players[playerIndex].type === 'human';
            this.showGameOver(isHuman ? '🎉 You Win! 🎉' : `${this.players[playerIndex].name} Wins!`, isHuman);
            return;
        }

        // Last card warning
        if (this.players[playerIndex].hand.length === 1 && playerIndex !== 0) {
            this.showMessage(`⚠️ ${this.players[playerIndex].name} has ONE card left!`, 2000);
        }

        // Handle 8 (suit selection)
        if (card.rank === '8') {
            if (playerIndex === 0) this.dom.suitModal.classList.remove('hidden');
            else this.botPickSuitPVE(playerIndex);
        } else {
            this.nextTurnPVE(skip);
        }
    }

    resolveEightPVE(suit) {
        this.gameForcedSuit = suit;
        this.dom.suitModal.classList.add('hidden');
        this.nextTurnPVE();
    }

    nextTurnPVE(skip = false) {
        let next = this.currentTurn + this.direction;
        if (skip) next += this.direction;
        const len = this.players.length;
        this.currentTurn = ((next % len) + len) % len;
        this.updateUI();
        this.checkTurnPVE();
    }

    humanDrawPVE() {
        if (this.deck.isEmpty) this.refillDeckPVE();
        if (this.deck.isEmpty) {
            this.showMessage('No cards left to draw!', 1500);
            return;
        }
        this.animateDrawCard(() => {
            this.players[0].hand.push(this.deck.deal());
            this.showMessage('Drew a card', 1200);
            this.nextTurnPVE();
        });
    }

    resolvePVEPenalty(idx) {
        const count = this.drawPenalty;
        this.drawPenalty = 0;
        const drawAll = () => {
            for (let i = 0; i < count; i++) {
                if (this.deck.isEmpty) this.refillDeckPVE();
                if (!this.deck.isEmpty) this.players[idx].hand.push(this.deck.deal());
            }
            this.nextTurnPVE();
        };
        // Animate the draw for the human player; bots resolve instantly
        if (idx === 0) this.animateDrawCard(drawAll);
        else drawAll();
    }

    refillDeckPVE() {
        if (this.discardPile.length <= 1) return;
        const top = this.discardPile.pop();
        this.deck.cards = this.discardPile;
        this.discardPile = [top];
        this.deck.shuffle();
    }

    // ==================== BOT AI ====================

    botTurnPVE() {
        const bot = this.players[this.currentTurn];
        const turnIdx = this.currentTurn;

        setTimeout(() => {
            // Handle draw penalty
            if (this.drawPenalty > 0) {
                const two = bot.hand.find(c => c.rank === '2');
                if (two) {
                    this.playBotCard(bot, two, turnIdx);
                } else {
                    this.showMessage(`${bot.name} draws ${this.drawPenalty} cards!`, 1800);
                    this.resolvePVEPenalty(turnIdx);
                }
                return;
            }

            // Find and play best valid card
            const valid = bot.hand.filter(c => this.isValidMovePVE(c));
            if (valid.length > 0) {
                // Strategy: play non-wild cards first, save 8s
                const nonEights = valid.filter(c => c.rank !== '8');
                const card = nonEights.length > 0 ? nonEights[0] : valid[0];
                this.playBotCard(bot, card, turnIdx);
            } else {
                if (this.deck.isEmpty) this.refillDeckPVE();
                if (!this.deck.isEmpty) {
                    bot.hand.push(this.deck.deal());
                    this.showMessage(`${bot.name} draws a card`, 1200);
                }
                this.nextTurnPVE();
            }
        }, CONFIG.BOT_THINK_MS);
    }

    playBotCard(bot, card, turnIdx) {
        bot.hand.splice(bot.hand.indexOf(card), 1);
        this.animateCardFromOpponent(turnIdx, card, () => this.playCardPVE(card, turnIdx));
    }

    botPickSuitPVE(idx) {
        setTimeout(() => {
            const bot = this.players[idx];
            const counts = { hearts: 0, diamonds: 0, clubs: 0, spades: 0 };

            bot.hand.forEach(card => {
                if (card.rank !== '8') counts[card.suit]++;
            });

            // Pick the most common suit
            const bestSuit = Object.entries(counts).reduce(
                (best, [suit, count]) => count > best.count ? { suit, count } : best,
                { suit: 'hearts', count: 0 }
            ).suit;

            this.gameForcedSuit = bestSuit;
            this.nextTurnPVE();
        }, CONFIG.BOT_THINK_MS);
    }
}

// ==================== INIT ====================
window.onload = () => { window.game = new Game(); };
