const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SYMBOLS = {
    'hearts': '♥',
    'diamonds': '♦',
    'clubs': '♣',
    'spades': '♠'
};

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

class Game {
    constructor() {
        this.deck = new Deck();
        this.players = [[], []]; // 0: Human, 1: Bot
        this.discardPile = [];
        this.currentTurn = 0; // 0 for human, 1 for bot
        this.activeSuit = null; // Used when an 8 is played
        this.gameForcedSuit = null; // The suit chosen after an 8
        this.gameOver = false;

        // UI Elements
        this.dom = {
            playerHand: document.getElementById('player-hand'),
            opponentHand: document.getElementById('opponent-hand'),
            discardPile: document.getElementById('discard-pile'),
            drawPile: document.getElementById('draw-pile'),
            turnIndicator: document.getElementById('turn-indicator'),
            playerCount: document.getElementById('player-card-count'),
            opponentCount: document.getElementById('opponent-card-count'),
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
        this.start();
    }

    bindEvents() {
        this.dom.drawPile.addEventListener('click', () => {
            if (this.currentTurn === 0 && !this.gameOver) {
                this.humanDraw();
            }
        });

        this.dom.suitOptions.addEventListener('click', (e) => {
            if (e.target.classList.contains('suit-btn')) {
                const suit = e.target.dataset.suit;
                this.resolveEight(suit);
            }
        });

        this.dom.playAgainBtn.addEventListener('click', () => this.start());
        this.dom.restartBtn.addEventListener('click', () => this.start());
    }

    start() {
        this.gameOver = false;
        this.deck.reset();
        this.players = [[], []];
        this.discardPile = [];
        this.gameForcedSuit = null;
        this.currentTurn = 0;

        this.dom.gameOverModal.classList.add('hidden');
        this.dom.suitModal.classList.add('hidden');
        this.dom.suitIndicator.classList.add('hidden');
        this.dom.restartBtn.classList.remove('hidden');

        // Deal 7 cards to each
        for (let i = 0; i < 7; i++) {
            this.players[0].push(this.deck.deal());
            this.players[1].push(this.deck.deal());
        }

        // Starters
        let startCard = this.deck.deal();
        while (startCard.rank === '8') {
            // 8s are bad starters generally for simple logic, put it back and reshuffle or just pick another
            this.deck.cards.unshift(startCard);
            this.deck.shuffle();
            startCard = this.deck.deal();
        }
        this.discardPile.push(startCard);
        this.activeSuit = startCard.suit;

        this.updateUI();
        this.checkTurn();
    }

    updateUI() {
        // Discard Pile
        const topCard = this.discardPile[this.discardPile.length - 1];
        this.dom.discardPile.innerHTML = '';
        if (topCard) {
            this.dom.discardPile.appendChild(this.createCardElement(topCard));
        }

        // Suit Indicator
        if (this.gameForcedSuit) {
            this.dom.suitIndicator.classList.remove('hidden');
            this.dom.currentSuitDisplay.textContent = this.gameForcedSuit;
            this.dom.currentSuitDisplay.className = (this.gameForcedSuit === 'hearts' || this.gameForcedSuit === 'diamonds') ? 'red' : 'black';
            // Simple color fix
            this.dom.currentSuitDisplay.style.color = (this.gameForcedSuit === 'hearts' || this.gameForcedSuit === 'diamonds') ? '#e53935' : '#212121';
        } else {
            this.dom.suitIndicator.classList.add('hidden');
        }

        // Hands
        this.renderPlayerHand();
        this.renderOpponentHand();

        // Counts
        this.dom.playerCount.textContent = this.players[0].length;
        this.dom.opponentCount.textContent = this.players[1].length;

        // Turn
        this.dom.turnIndicator.textContent = this.currentTurn === 0 ? "Your Turn" : "Bot's Turn";
        this.dom.turnIndicator.style.color = this.currentTurn === 0 ? '#ffd700' : '#fff';
    }

    renderPlayerHand() {
        this.dom.playerHand.innerHTML = '';
        this.players[0].forEach((card, index) => {
            const el = this.createCardElement(card);
            el.dataset.index = index;
            el.onclick = () => {
                if (this.currentTurn === 0 && !this.gameOver) {
                    this.attemptPlay(index);
                }
            };
            this.dom.playerHand.appendChild(el);
        });
    }

    renderOpponentHand() {
        this.dom.opponentHand.innerHTML = '';
        this.players[1].forEach(() => {
            const el = document.createElement('div');
            el.className = 'card';
            const back = document.createElement('div');
            back.className = 'card-back';
            el.appendChild(back);
            this.dom.opponentHand.appendChild(el);
        });
    }

    createCardElement(card) {
        const el = document.createElement('div');
        el.className = `card ${card.color} deal-anim`;

        const top = document.createElement('div');
        top.className = 'card-top';
        top.innerHTML = `${card.rank}<span>${SYMBOLS[card.suit]}</span>`;

        const center = document.createElement('div');
        center.className = 'card-center';
        center.innerHTML = `${SYMBOLS[card.suit]}`;

        const bottom = document.createElement('div');
        bottom.className = 'card-bottom';
        bottom.innerHTML = `${card.rank}<span>${SYMBOLS[card.suit]}</span>`;

        el.appendChild(top);
        el.appendChild(center);
        el.appendChild(bottom);
        return el;
    }

    isValidMove(card) {
        // If an 8 triggered a suit change, we must match that suit (unless playing another 8)
        const effectiveSuit = this.gameForcedSuit || this.discardPile[this.discardPile.length - 1].suit;
        const effectiveRank = this.discardPile[this.discardPile.length - 1].rank;

        if (card.rank === '8') return true;
        if (card.suit === effectiveSuit) return true;
        if (card.rank === effectiveRank) return true;

        return false;
    }

    attemptPlay(cardIndex) {
        const card = this.players[0][cardIndex];
        if (this.isValidMove(card)) {
            // Play card
            this.players[0].splice(cardIndex, 1);
            this.playCardHelper(card, 0);
        } else {
            this.showMessage("Invalid Move!");
            this.shakeNode(this.dom.playerHand.children[cardIndex]);
        }
    }

    playCardHelper(card, playerIndex) {
        this.discardPile.push(card);
        this.gameForcedSuit = null; // Reset forced suit unless this is an 8
        this.updateUI();

        if (this.players[playerIndex].length === 0) {
            this.endGame(playerIndex);
            return;
        }

        if (card.rank === '8') {
            if (playerIndex === 0) {
                // Human: Show modal
                this.dom.suitModal.classList.remove('hidden');
            } else {
                // Bot: Choose suit
                this.botPickSuit();
            }
        } else {
            this.nextTurn();
        }
    }

    resolveEight(suit) {
        this.gameForcedSuit = suit;
        this.dom.suitModal.classList.add('hidden');
        this.updateUI();
        this.nextTurn();
    }

    botPickSuit() {
        // Bot picks the suit it has the most of
        const suitCounts = {};
        this.players[1].forEach(c => {
            suitCounts[c.suit] = (suitCounts[c.suit] || 0) + 1;
        });
        const bestSuit = Object.keys(suitCounts).reduce((a, b) => suitCounts[a] > suitCounts[b] ? a : b, 'hearts');

        // Simulate delay for thought
        setTimeout(() => {
            this.gameForcedSuit = bestSuit;
            this.showMessage(`Bot chose ${bestSuit}`);
            this.updateUI();
            this.nextTurn();
        }, 1000);
    }

    humanDraw() {
        if (this.deck.isEmpty) {
            this.refillDeck();
            if (this.deck.isEmpty) { // If still empty (extremely rare boundary)
                this.showMessage("Deck Empty - Pass");
                this.nextTurn();
                return;
            }
        }

        const card = this.deck.deal();
        this.players[0].push(card);
        this.updateUI();

        // If playable, they can play it immediately? Usually in Crazy8s, yes or no.
        // Let's say yes, or just end turn?
        // Standard rule: draw until you can play or draw 1 and pass.
        // Let's implement: Draw 1. If can play, you can play.
        // But to keep it simple: Draw 1, if you can play it, good. If not, pass or keep drawing?
        // Let's do Single Draw Limit per turn for better UX (prevent infinite drawing).
        // Actually, normally you draw until you can play.
        // Let's do: Draw one. If valid, good. If not, turn passes to bot automatically?
        // No, player might want to play it.
        // Simplest valid UX: User clicks draw. Card added. If valid, they play. If no valid options, they must draw again.

        // Check if user has ANY valid moves now.
        const canMove = this.players[0].some(c => this.isValidMove(c));
        if (!canMove) {
            this.showMessage("No moves, draw again!");
        } else {
            this.showMessage("You drew a card.");
        }
    }

    botTurn() {
        this.dom.turnIndicator.textContent = "Bot Thinking...";

        setTimeout(() => {
            // 1. Try to find a valid move
            const hand = this.players[1];
            let playable = hand.filter(c => this.isValidMove(c));

            if (playable.length > 0) {
                // Priority: Non-8s first (save 8s), unless only 8s
                let choice = playable.find(c => c.rank !== '8');
                if (!choice) choice = playable[0]; // Must play 8

                // Play it
                const idx = hand.indexOf(choice);
                hand.splice(idx, 1);
                this.playCardHelper(choice, 1);
            } else {
                // Draw
                if (this.deck.isEmpty) this.refillDeck();

                if (this.deck.isEmpty) {
                    // Pass
                    this.showMessage("Bot Passes");
                    this.nextTurn();
                    return;
                }

                const card = this.deck.deal();
                this.players[1].push(card);
                this.updateUI();
                this.showMessage("Bot Draws");

                // Retry turn immediately (recurse with delay)
                setTimeout(() => this.botTurn(), 1000);
            }
        }, 1500);
    }

    nextTurn() {
        this.currentTurn = 1 - this.currentTurn;
        this.updateUI();
        this.checkTurn();
    }

    checkTurn() {
        if (this.currentTurn === 1) {
            this.botTurn();
        }
    }

    refillDeck() {
        if (this.discardPile.length <= 1) return; // Nothing to refill from

        const top = this.discardPile.pop();
        // Move rest to deck
        this.deck.cards = this.discardPile;
        this.discardPile = [top];
        this.deck.shuffle();
        this.showMessage("Reshuffling deck...");
    }

    endGame(winnerIndex) {
        this.gameOver = true;
        const msg = winnerIndex === 0 ? "You Win!" : "Bot Wins!";
        this.dom.winnerText.textContent = msg;
        this.dom.gameOverModal.classList.remove('hidden');
    }

    showMessage(text) {
        this.dom.messageArea.textContent = text;
        this.dom.messageArea.style.opacity = '1';
        setTimeout(() => {
            this.dom.messageArea.style.opacity = '0';
        }, 2000);
    }

    shakeNode(node) {
        if (!node) return;
        node.classList.add('shake');
        setTimeout(() => node.classList.remove('shake'), 400);
    }
}

// Start game on load
window.onload = () => {
    new Game();
};
