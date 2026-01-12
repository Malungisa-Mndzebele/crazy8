console.log("Crazy 8 Client v1.2 Loaded - Connecting to Render");
const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SYMBOLS = { 'hearts': '♥', 'diamonds': '♦', 'clubs': '♣', 'spades': '♠' };
const BOT_NAMES = ['Hal', 'Chip', 'Data', 'Robo', 'Spark', 'Wire', 'Glitch', 'Byte'];

class Card {
    constructor(suit, rank, id) {
        this.suit = suit;
        this.rank = rank;
        this.id = id || `${rank}-${suit}`;
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

class Player {
    constructor(name, type = 'bot', id = null) {
        this.name = name;
        this.type = type;
        this.id = id;
        this.hand = [];
    }
}

class Game {
    constructor() {
        this.deck = new Deck();
        this.players = [];
        this.discardPile = [];
        this.currentTurn = 0;
        this.direction = 1;
        this.drawPenalty = 0;
        this.gameForcedSuit = null;
        this.gameOver = false;

        // Game Settings
        this.gameMode = 'pve'; // 'pve', 'online'
        this.socket = null;
        this.roomId = null;
        this.myPlayerId = null;

        // DOM Elements
        this.dom = {
            landingPage: document.getElementById('landing-page'),
            waitingRoomModal: document.getElementById('waiting-room-modal'),

            landingCreateBtn: document.getElementById('landing-create-btn'),
            landingJoinBtn: document.getElementById('landing-join-btn'),
            landingPveBtn: document.getElementById('landing-pve-btn'),

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

        this.bindEvents();
        // Landing page is visible by default via CSS options
    }

    bindEvents() {
        // PVE Start
        this.dom.landingPveBtn.addEventListener('click', () => {
            const name = this.dom.landingPlayerName.value || "Player";
            const count = parseInt(this.dom.landingPlayerCount.value) || 2;
            this.startPVE(count, name);
        });

        // Online Buttons
        this.dom.landingCreateBtn.addEventListener('click', () => {
            if (!this.ensureSocketConnection()) return;
            const name = this.dom.landingPlayerName.value || "Player";
            const count = parseInt(this.dom.landingPlayerCount.value) || 2;
            this.socket.emit('createRoom', { name, maxPlayers: count });
        });

        this.dom.landingJoinBtn.addEventListener('click', () => {
            if (!this.ensureSocketConnection()) return;
            const name = this.dom.landingPlayerName.value || "Player";
            const roomId = this.dom.landingRoomInput.value.trim();
            if (roomId) this.socket.emit('joinRoom', { roomId, name });
        });

        this.dom.startOnlineBtn.addEventListener('click', () => {
            if (this.socket && this.roomId) this.socket.emit('startGame', this.roomId);
        });

        // Gameplay Interaction
        this.dom.drawPile.addEventListener('click', () => {
            if (this.gameOver) return;
            if (this.gameMode === 'pve') {
                if (this.isHumanTurn()) {
                    if (this.drawPenalty > 0) this.resolvePVEPenalty(0);
                    else this.humanDrawPVE();
                }
            } else {
                // Online
                this.socket.emit('drawCard', this.roomId);
            }
        });

        this.dom.suitOptions.addEventListener('click', (e) => {
            if (e.target.classList.contains('suit-btn')) {
                const suit = e.target.dataset.suit;
                if (this.gameMode === 'pve') {
                    this.resolveEightPVE(suit);
                } else {
                    this.socket.emit('pickSuit', { roomId: this.roomId, suit: suit });
                    this.dom.suitModal.classList.add('hidden');
                }
            }
        });

        this.dom.playAgainBtn.addEventListener('click', () => {
            window.location.reload();
        });

        this.dom.restartBtn.addEventListener('click', () => {
            window.location.reload();
        });
    }

    ensureSocketConnection() {
        if (this.socket) return true;
        if (window.io) {
            this.initSocket();
            return true;
        }
        alert("Online play unavailable: Cannot connect to game server.\n\nPlease check your internet connection or try again later.");
        console.error("Socket.io client library not loaded. window.io is undefined.");
        return false;
    }

    initSocket() {
        // Connect to the Render backend explicitly
        // If we are on localhost, we can still use the render backend or localhost:3000
        // But since the user wants to focus on "live", we point to the live server.
        // We can check window.location.hostname to decide.

        const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        // USE YOUR ACTUAL BACKEND URL HERE
        const backendUrl = isLocal ? 'http://localhost:3001' : 'https://crazy-8-game.onrender.com';

        console.log("Connecting to game server at:", backendUrl);
        this.socket = io(backendUrl, {
            transports: ['websocket', 'polling']
        });

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
            this.dom.playerListDisplay.innerHTML = list.map(p => `<div>${p.name} ${p.id === this.socket.id ? '(You)' : ''}</div>`).join('');
            // Only host can start? For simplicity anyone in first slot.
            if (list.length >= 2 && list[0].id === this.socket.id) {
                this.dom.startOnlineBtn.classList.remove('hidden');
            }
        });

        this.socket.on('gameStarted', () => {
            this.dom.waitingRoomModal.classList.add('hidden');
            this.dom.landingPage.classList.add('hidden');
        });

        this.socket.on('gameState', (state) => {
            this.syncState(state);
        });

        this.socket.on('gameOver', ({ winner }) => {
            this.dom.winnerText.textContent = `${winner} Wins!`;
            this.dom.gameOverModal.classList.remove('hidden');
        });
    }

    enterWaitingRoom() {
        this.dom.landingPage.classList.add('hidden');
        this.dom.waitingRoomModal.classList.remove('hidden');
        this.dom.displayRoomId.textContent = this.roomId;
    }

    // --- PVE Logic ---

    startPVE(totalPlayers, playerName) {
        this.gameMode = 'pve';
        this.gameOver = false;
        this.dom.landingPage.classList.add('hidden');
        this.deck.reset();
        this.players = [];
        this.discardPile = [];
        this.gameForcedSuit = null;
        this.currentTurn = 0;
        this.direction = 1;
        this.drawPenalty = 0;

        this.players.push(new Player(playerName || 'You', 'human'));
        const botNames = [...BOT_NAMES].sort(() => 0.5 - Math.random());
        for (let i = 1; i < totalPlayers; i++) {
            this.players.push(new Player(botNames[i - 1] || `Bot ${i}`, 'bot'));
        }

        this.players.forEach(p => {
            for (let i = 0; i < 5; i++) p.hand.push(this.deck.deal());
            if (totalPlayers === 2) p.hand.push(this.deck.deal());
        });

        let startCard = this.deck.deal();
        while (['8', '2', '7', 'J'].includes(startCard.rank)) {
            this.deck.cards.unshift(startCard);
            this.deck.shuffle();
            startCard = this.deck.deal();
        }
        this.discardPile.push(startCard);

        this.updateUI();
        this.checkTurnPVE();
    }

    isHumanTurn() {
        // Only pve uses this locally. Online uses server state.
        return this.players[this.currentTurn].type === 'human';
    }

    // --- Shared / UI ---

    updateUI() {
        // Common UI Update
        const topCard = this.discardPile[this.discardPile.length - 1];
        this.dom.discardPile.innerHTML = '';
        if (topCard) {
            this.dom.discardPile.appendChild(this.createCardElement(topCard));
        }

        if (this.gameForcedSuit) {
            this.dom.suitIndicator.classList.remove('hidden');
            this.dom.currentSuitDisplay.textContent = this.gameForcedSuit;
            this.dom.currentSuitDisplay.className = (['hearts', 'diamonds'].includes(this.gameForcedSuit)) ? 'red' : 'black';
        } else {
            this.dom.suitIndicator.classList.add('hidden');
        }

        // Opponents
        this.dom.opponentsContainer.innerHTML = '';
        this.players.forEach((p, i) => {
            let isMe = false;
            if (this.gameMode === 'pve') isMe = (i === 0);
            else isMe = (p.id === this.myPlayerId);

            if (!isMe) {
                const isActive = (i === this.currentTurn);
                const el = document.createElement('div');
                el.className = `opponent-card ${isActive ? 'active-turn' : ''}`;

                let cardsHtml = `<div class="opponent-hand-mini">`;
                const visualCount = Math.min(p.hand.length, 5); // In online we might just have count? logic below
                for (let c = 0; c < visualCount; c++) cardsHtml += '<div class="mini-card-back"></div>';
                cardsHtml += '</div>';

                el.innerHTML = `
                     <div class="avatar robot">👤</div>
                     <div class="name">${p.name}</div>
                     <div class="card-count">${p.hand.length} Cards</div>
                     ${cardsHtml}
                 `;
                this.dom.opponentsContainer.appendChild(el);
            }
        });

        // My Hand
        let myPlayer = null;
        if (this.gameMode === 'pve') myPlayer = this.players[0];
        else myPlayer = this.players.find(p => p.id === this.myPlayerId);

        if (myPlayer) {
            this.dom.playerName.textContent = myPlayer.name;
            this.dom.playerHand.innerHTML = '';
            myPlayer.hand.forEach((card, index) => {
                const el = this.createCardElement(card);
                el.dataset.index = index;
                el.onclick = () => {
                    const cardEl = this.dom.playerHand.children[index];
                    if (this.gameMode === 'pve') {
                        if (this.currentTurn === 0 && !this.gameOver) this.attemptPlayPVE(index);
                    } else {
                        // Optimistic animation for Online
                        // We assume it's valid for visual feedback, server validates real logic.
                        // We check basic turn/card validity locally to avoid silly animations.
                        // Simplified check: is it my turn?
                        const isMyTurn = (this.players[this.currentTurn].id === this.myPlayerId);
                        if (isMyTurn && !this.gameOver) {
                            this.animatePlayCard(cardEl, () => {
                                this.socket.emit('playCard', { roomId: this.roomId, cardIndex: index });
                            });
                        }
                    }
                };
                this.dom.playerHand.appendChild(el);
            });
            this.dom.playerCountDisplay.textContent = myPlayer.hand.length;
        }

        // Turn Indicator
        if (this.players[this.currentTurn]) {
            const currentName = this.players[this.currentTurn].name;
            let statusText = `${currentName}'s Turn`;
            let color = '#fff';

            let isMyTurn = (this.gameMode === 'pve' && this.currentTurn === 0) ||
                (this.gameMode === 'online' && this.players[this.currentTurn].id === this.myPlayerId);

            if (isMyTurn) {
                statusText = "Your Turn";
                color = '#ffd700';
                if (this.drawPenalty > 0) statusText += ` (Play 2 or Draw ${this.drawPenalty})`;
            }
            this.dom.turnIndicator.textContent = statusText;
            this.dom.turnIndicator.style.color = color;
        }
    }

    // --- Online Sync ---
    syncState(state) {
        this.players = state.players.map(p => {
            // Rehydrate cards
            p.hand = p.hand.map(c => new Card(c.suit, c.rank));
            return p;
        });
        this.discardPile = state.discardPile.map(c => new Card(c.suit, c.rank));
        this.currentTurn = state.currentTurn;
        this.gameForcedSuit = state.gameForcedSuit;
        this.drawPenalty = state.drawPenalty;

        // Handle Pick Suit UI
        const myTurn = (this.players[this.currentTurn].id === this.myPlayerId);
        const top = this.discardPile[this.discardPile.length - 1];
        if (myTurn && top.rank === '8' && !this.gameForcedSuit) {
            this.dom.suitModal.classList.remove('hidden');
        } else {
            this.dom.suitModal.classList.add('hidden');
        }

        this.updateUI();
    }

    // --- Helpers ---

    createCardElement(card) {
        const el = document.createElement('div');
        el.className = `card ${card.color} deal-anim`;
        el.innerHTML = `
            <div class="card-top">${card.rank}<span>${SYMBOLS[card.suit]}</span></div>
            <div class="card-center">${SYMBOLS[card.suit]}</div>
            <div class="card-bottom">${card.rank}<span>${SYMBOLS[card.suit]}</span></div>
        `;
        return el;
    }

    showMessage(text) {
        this.dom.messageArea.textContent = text;
        this.dom.messageArea.style.opacity = '1';
        setTimeout(() => {
            this.dom.messageArea.style.opacity = '0';
        }, 2000);
    }

    // --- PVE Logic (simplified for brevity, keeping original flows) ---
    checkTurnPVE() {
        if (!this.gameOver && this.players[this.currentTurn].type === 'bot') {
            this.botTurnPVE();
        }
    }

    attemptPlayPVE(cardIndex) {
        const player = this.players[0];
        const card = player.hand[cardIndex];

        if (this.isValidMovePVE(card)) {
            const cardEl = this.dom.playerHand.children[cardIndex];

            // Animation
            this.animatePlayCard(cardEl, () => {
                player.hand.splice(cardIndex, 1);
                this.playCardHelperPVE(card, 0);
            });

        } else {
            // Shake logic
            const cardEl = this.dom.playerHand.children[cardIndex];
            cardEl.classList.add('shake');
            setTimeout(() => cardEl.classList.remove('shake'), 500);
        }
    }

    animatePlayCard(startEl, callback) {
        if (!startEl) {
            callback();
            return;
        }

        const rect = startEl.getBoundingClientRect();
        const targetRect = this.dom.discardPile.getBoundingClientRect();

        // Create Flying Clone
        const clone = startEl.cloneNode(true);
        clone.classList.add('flying-card');
        clone.style.left = `${rect.left}px`;
        clone.style.top = `${rect.top}px`;
        clone.style.width = `${rect.width}px`;
        clone.style.height = `${rect.height}px`;
        clone.style.transform = 'none'; // Reset any hover transforms

        document.body.appendChild(clone);

        // Hide original immediately
        startEl.style.opacity = '0';

        // Animate
        // Force reflow
        clone.offsetHeight;

        // Calculate center delta
        const deltaX = (targetRect.left + targetRect.width / 2) - (rect.left + rect.width / 2);
        const deltaY = (targetRect.top + targetRect.height / 2) - (rect.top + rect.height / 2);

        clone.style.transform = `translate(${deltaX}px, ${deltaY}px) rotate(360deg) scale(1.0)`;

        setTimeout(() => {
            clone.remove();
            callback();
        }, 600); // Match CSS transition time
    }

    isValidMovePVE(card) {
        if (this.drawPenalty > 0) return card.rank === '2';
        const effectiveSuit = this.gameForcedSuit || this.discardPile[this.discardPile.length - 1].suit;
        const effectiveRank = this.discardPile[this.discardPile.length - 1].rank;
        return (card.rank === '8' || card.suit === effectiveSuit || card.rank === effectiveRank);
    }

    playCardHelperPVE(card, playerIndex) {
        this.discardPile.push(card);
        this.gameForcedSuit = null;
        let skip = false;
        if (card.rank === '2') this.drawPenalty += 2;
        if (card.rank === '7') skip = true;
        if (card.rank === 'J') this.direction *= -1;

        if (this.players[playerIndex].hand.length === 0) {
            // Win
            this.dom.winnerText.textContent = "You Win!";
            this.dom.gameOverModal.classList.remove('hidden');
            this.gameOver = true;
            return;
        }

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

    botPickSuitPVE(idx) {
        setTimeout(() => {
            this.gameForcedSuit = 'hearts'; // dumb bot
            this.nextTurnPVE();
        }, 1000);
    }

    humanDrawPVE() {
        if (this.deck.isEmpty) this.refillDeckPVE();
        if (!this.deck.isEmpty) {
            this.players[0].hand.push(this.deck.deal());
            this.nextTurnPVE();
        }
    }

    resolvePVEPenalty(idx) {
        const p = this.players[idx];
        const count = this.drawPenalty;
        this.drawPenalty = 0;
        for (let i = 0; i < count; i++) {
            if (this.deck.isEmpty) this.refillDeckPVE();
            if (!this.deck.isEmpty) p.hand.push(this.deck.deal());
        }
        this.nextTurnPVE(false);
    }

    nextTurnPVE(skip = false) {
        let next = this.currentTurn + this.direction;
        if (skip) next += this.direction;
        const len = this.players.length;
        this.currentTurn = ((next % len) + len) % len;
        this.updateUI();
        this.checkTurnPVE();
    }

    botTurnPVE() {
        const bot = this.players[this.currentTurn];
        setTimeout(() => {
            // Simplified bot
            const valid = bot.hand.filter(c => this.isValidMovePVE(c));
            if (valid.length > 0) {
                const c = valid[0];
                bot.hand.splice(bot.hand.indexOf(c), 1);
                this.playCardHelperPVE(c, this.currentTurn);
            } else {
                if (this.deck.isEmpty) this.refillDeckPVE();
                if (!this.deck.isEmpty) bot.hand.push(this.deck.deal());
                this.nextTurnPVE();
            }
        }, 1000);
    }

    refillDeckPVE() {
        if (this.discardPile.length <= 1) return;
        const top = this.discardPile.pop();
        this.deck.cards = this.discardPile;
        this.discardPile = [top];
        this.deck.shuffle();
    }
}

window.onload = () => {
    new Game();
};
