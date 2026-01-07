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
            setupModal: document.getElementById('setup-modal'),
            waitingRoomModal: document.getElementById('waiting-room-modal'),
            startBtn: document.getElementById('start-game-btn'),
            createRoomBtn: document.getElementById('create-room-btn'),
            joinRoomBtn: document.getElementById('join-room-btn'),
            startOnlineBtn: document.getElementById('start-online-game-btn'),

            pveControls: document.getElementById('pve-controls'),
            onlineControls: document.getElementById('online-controls'),
            lobbyBtns: document.getElementById('lobby-btns'),
            lobbyStatus: document.getElementById('lobby-status'),

            playerCountInput: document.getElementById('player-count-input'),
            bgModeBtns: document.querySelectorAll('.mode-btn'),
            setupDescription: document.getElementById('setup-description'),

            playerNameInput: document.getElementById('player-name-input'),
            roomIdInput: document.getElementById('room-id-input'),
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
        this.dom.setupModal.classList.remove('hidden');
    }

    bindEvents() {
        // Mode Selection
        this.dom.bgModeBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                this.dom.bgModeBtns.forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                this.gameMode = btn.dataset.mode;

                if (this.gameMode === 'pve') {
                    this.dom.pveControls.classList.remove('hidden');
                    this.dom.onlineControls.classList.add('hidden');
                    this.dom.startBtn.classList.remove('hidden');
                    this.dom.lobbyBtns.classList.add('hidden');
                    this.dom.setupDescription.textContent = "Play against computer opponents.";
                } else {
                    this.dom.pveControls.classList.add('hidden');
                    this.dom.onlineControls.classList.remove('hidden');
                    this.dom.startBtn.classList.add('hidden');
                    this.dom.lobbyBtns.classList.remove('hidden');
                    this.dom.setupDescription.textContent = "Create or Join an online room.";

                    if (!this.socket && window.io) {
                        this.initSocket();
                    }
                }
            });
        });

        this.dom.startBtn.addEventListener('click', () => {
            const count = parseInt(this.dom.playerCountInput.value);
            this.startPVE(count);
        });

        // Online Buttons
        this.dom.createRoomBtn.addEventListener('click', () => {
            const name = this.dom.playerNameInput.value || "Player";
            if (this.socket) this.socket.emit('createRoom', name);
        });

        this.dom.joinRoomBtn.addEventListener('click', () => {
            const name = this.dom.playerNameInput.value || "Player";
            const roomId = this.dom.roomIdInput.value.trim();
            if (this.socket && roomId) this.socket.emit('joinRoom', { roomId, name });
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

    initSocket() {
        this.socket = io();

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
            this.dom.setupModal.classList.add('hidden');
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
        this.dom.setupModal.classList.add('hidden');
        this.dom.waitingRoomModal.classList.remove('hidden');
        this.dom.displayRoomId.textContent = this.roomId;
    }

    // --- PVE Logic ---

    startPVE(totalPlayers) {
        this.gameMode = 'pve';
        this.gameOver = false;
        this.dom.setupModal.classList.add('hidden');
        this.deck.reset();
        this.players = [];
        this.discardPile = [];
        this.gameForcedSuit = null;
        this.currentTurn = 0;
        this.direction = 1;
        this.drawPenalty = 0;

        this.players.push(new Player('You', 'human'));
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
                    if (this.gameMode === 'pve') {
                        if (this.currentTurn === 0 && !this.gameOver) this.attemptPlayPVE(index);
                    } else {
                        this.socket.emit('playCard', { roomId: this.roomId, cardIndex: index });
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
            player.hand.splice(cardIndex, 1);
            this.playCardHelperPVE(card, 0);
        } else {
            // Shake logic
        }
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
