console.log("Crazy 8 Client v2.8 Loaded");

// ==================== CONSTANTS ====================
const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SYMBOLS = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };
const SPECIAL_CARDS = ['8', '2', '7', 'J'];
const BOT_NAMES = ['Hal', 'Chip', 'Data', 'Robo', 'Spark', 'Wire', 'Glitch', 'Byte'];

const CONFIG = {
    CARDS_PER_PLAYER: 5,
    CARDS_PER_PLAYER_TWO_PLAYER: 7,
    CARD_ANIMATION_MS: 800,
    BOT_THINK_MS: 900,
    MESSAGE_DISPLAY_MS: 2500,
    SHAKE_DURATION_MS: 500,
    MAX_VISIBLE_DISCARD: 5,
    MAX_MINI_CARDS: 5
};

const BACKEND_URL = (() => {
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    return isLocal ? 'http://localhost:3001' : 'https://crazy-8-game-g9ju.onrender.com';
})();

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

        // Networking
        this.gameMode = 'pve';
        this.socket = null;
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
            landingQuickMatchBtn: document.getElementById('landing-quickmatch-btn'),
            startOnlineBtn: document.getElementById('start-online-game-btn'),
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

        // Online - Create / Join / Quick Match
        dom.landingCreateBtn.addEventListener('click', () => {
            if (!this.ensureSocketConnection()) return;
            this.socket.emit('createRoom', { name: this.getPlayerNameInput(), maxPlayers: this.getPlayerCount() });
        });

        dom.landingJoinBtn.addEventListener('click', () => {
            if (!this.ensureSocketConnection()) return;
            const roomId = dom.landingRoomInput.value.trim();
            if (roomId) this.socket.emit('joinRoom', { roomId, name: this.getPlayerNameInput() });
        });

        dom.landingQuickMatchBtn.addEventListener('click', () => {
            if (!this.ensureSocketConnection()) return;
            this.socket.emit('quickMatch', { name: this.getPlayerNameInput() });
        });

        dom.startOnlineBtn.addEventListener('click', () => {
            if (this.socket && this.roomId) this.socket.emit('startGame', this.roomId);
        });

        // Gameplay
        dom.drawPile.addEventListener('click', () => this.handleDrawClick());

        dom.suitOptions.addEventListener('click', (e) => {
            if (!e.target.classList.contains('suit-btn')) return;
            const suit = e.target.dataset.suit;
            if (this.gameMode === 'pve') {
                this.resolveEightPVE(suit);
            } else {
                this.socket.emit('pickSuit', { roomId: this.roomId, suit });
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

    // ==================== SOCKET / ONLINE ====================

    ensureSocketConnection() {
        if (this.socket) return true;
        if (window.io) { this.initSocket(); return true; }
        alert("Online play unavailable: Cannot connect to game server.\n\nPlease check your internet connection or try again later.");
        return false;
    }

    initSocket() {
        console.log("Connecting to game server at:", BACKEND_URL);
        this.socket = io(BACKEND_URL, { transports: ['websocket', 'polling'] });

        // Room events
        this.socket.on('roomCreated', (id) => {
            this.roomId = id;
            this.myPlayerId = this.socket.id;
            this.enterWaitingRoom();
        });

        this.socket.on('joinedRoom', (id) => {
            this.roomId = id;
            this.myPlayerId = this.socket.id;
            this.enterWaitingRoom();
        });

        this.socket.on('playerList', (list) => {
            this.dom.playerListDisplay.innerHTML = list
                .map(p => `<div>${p.name} ${p.id === this.socket.id ? '(You)' : ''}</div>`)
                .join('');
            if (list.length >= 2 && list[0].id === this.socket.id) {
                this.dom.startOnlineBtn.classList.remove('hidden');
            }
        });

        // Game events
        this.socket.on('gameStarted', () => {
            this.gameMode = 'online';
            this.dom.waitingRoomModal.classList.add('hidden');
            this.dom.landingPage.classList.add('hidden');
        });

        this.socket.on('gameState', (state) => this.syncState(state));

        this.socket.on('gameOver', ({ winner, reason }) => {
            const message = reason ? `${winner} Wins! (${reason})` : `${winner} Wins!`;
            this.dom.winnerText.textContent = message;
            this.dom.gameOverModal.classList.remove('hidden');
        });

        // Disconnect events
        this.socket.on('playerDisconnected', ({ name }) => this.showMessage(`${name} disconnected`));
        this.socket.on('playerLeft', ({ name }) => this.showMessage(`${name} left the room`));
    }

    enterWaitingRoom() {
        this.dom.landingPage.classList.add('hidden');
        this.dom.waitingRoomModal.classList.remove('hidden');
        this.dom.displayRoomId.textContent = this.roomId;
    }

    syncState(state) {
        const myIndex = state.myIndex ?? state.players.findIndex(p => p.id === this.myPlayerId);

        this.players = state.players.map((p, i) => {
            const player = new Player(p.name, 'online', p.id);
            player.handCount = p.handCount || 0;

            if (p.hand?.length > 0) {
                player.hand = p.hand.map(c => new Card(c.suit, c.rank));
            } else if (i === myIndex && state.myHand) {
                player.hand = state.myHand.map(c => new Card(c.suit, c.rank));
            }
            return player;
        });

        this.discardPile = state.discardPile.map(c => new Card(c.suit, c.rank));
        this.currentTurn = state.currentTurn;
        this.gameForcedSuit = state.gameForcedSuit;
        this.drawPenalty = state.drawPenalty;

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

    renderDiscardPile() {
        this.dom.discardPile.innerHTML = '';
        const startIdx = Math.max(0, this.discardPile.length - CONFIG.MAX_VISIBLE_DISCARD);

        for (let i = startIdx; i < this.discardPile.length; i++) {
            const cardEl = this.createCardElement(this.discardPile[i]);
            const isTop = (i === this.discardPile.length - 1);

            if (isTop) {
                cardEl.style.zIndex = 100;
                cardEl.classList.add('top-card');
            } else {
                const rotation = (Math.random() - 0.5) * 30;
                const offsetX = (Math.random() - 0.5) * 20;
                const offsetY = (Math.random() - 0.5) * 10;
                cardEl.style.transform = `rotate(${rotation}deg) translate(${offsetX}px, ${offsetY}px)`;
                cardEl.style.zIndex = i - startIdx;
            }

            cardEl.style.position = 'absolute';
            this.dom.discardPile.appendChild(cardEl);
        }
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
            this.dom.playerHand.appendChild(el);
        });

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
        const count = this.gameMode === 'pve' ? this.deck.cards.length : '?';
        let label = this.dom.drawPile.querySelector('.deck-count-label');
        if (!label) {
            label = document.createElement('div');
            label.className = 'deck-count-label';
            this.dom.drawPile.appendChild(label);
        }
        label.textContent = this.gameMode === 'pve' ? `${count}` : '';
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
        el.className = `card ${card.color} deal-anim`;
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

    // ==================== INTERACTION HANDLERS ====================

    handleDrawClick() {
        if (this.gameOver) return;

        if (this.gameMode === 'pve') {
            if (!this.isMyTurn()) return;
            if (this.drawPenalty > 0) this.resolvePVEPenalty(0);
            else this.humanDrawPVE();
        } else {
            this.socket.emit('drawCard', this.roomId);
        }
    }

    handleCardClick(index) {
        if (this.gameOver) return;
        if (!this.isMyTurn()) {
            this.showMessage("Wait for your turn!", 1200);
            return;
        }

        const cardEl = this.dom.playerHand.children[index];

        if (this.gameMode === 'pve') {
            this.attemptPlayPVE(index);
        } else {
            this.animatePlayCard(cardEl, () => {
                this.socket.emit('playCard', { roomId: this.roomId, cardIndex: index });
            });
        }
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
            const cardEl = this.dom.playerHand.children[cardIndex];
            cardEl.classList.add('shake');
            const reason = this.drawPenalty > 0 ? 'Must play a 2 or draw!' : 'Card doesn\'t match!';
            this.showMessage(reason, 1500);
            setTimeout(() => cardEl.classList.remove('shake'), CONFIG.SHAKE_DURATION_MS);
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
            this.gameOver = true;
            const isHuman = this.players[playerIndex].type === 'human';
            this.dom.winnerText.textContent = isHuman ? '🎉 You Win! 🎉' : `${this.players[playerIndex].name} Wins!`;
            this.dom.gameOverModal.classList.remove('hidden');
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
        if (!this.deck.isEmpty) {
            this.players[0].hand.push(this.deck.deal());
            this.showMessage('Drew a card', 1200);
            this.nextTurnPVE();
        } else {
            this.showMessage('No cards left to draw!', 1500);
        }
    }

    resolvePVEPenalty(idx) {
        const count = this.drawPenalty;
        this.drawPenalty = 0;
        for (let i = 0; i < count; i++) {
            if (this.deck.isEmpty) this.refillDeckPVE();
            if (!this.deck.isEmpty) this.players[idx].hand.push(this.deck.deal());
        }
        this.nextTurnPVE();
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
                    bot.hand.splice(bot.hand.indexOf(two), 1);
                    this.playCardPVE(two, turnIdx);
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
                bot.hand.splice(bot.hand.indexOf(card), 1);
                this.playCardPVE(card, turnIdx);
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
window.onload = () => new Game();
