const mongoose = require('mongoose');

const playerSchema = new mongoose.Schema({
    username: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        minlength: 2,
        maxlength: 20
    },
    email: {
        type: String,
        sparse: true,
        trim: true,
        lowercase: true
    },
    passwordHash: {
        type: String,
        default: null // For guest players, no password required
    },
    isGuest: {
        type: Boolean,
        default: true
    },
    stats: {
        gamesPlayed: { type: Number, default: 0 },
        gamesWon: { type: Number, default: 0 },
        gamesLost: { type: Number, default: 0 },
        totalCardsPlayed: { type: Number, default: 0 },
        eightPlayed: { type: Number, default: 0 } // Special: 8s played
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    lastActiveAt: {
        type: Date,
        default: Date.now
    }
});

// Virtual for win rate
playerSchema.virtual('winRate').get(function () {
    if (this.stats.gamesPlayed === 0) return 0;
    return ((this.stats.gamesWon / this.stats.gamesPlayed) * 100).toFixed(1);
});

// Update last active timestamp
playerSchema.methods.updateActivity = function () {
    this.lastActiveAt = new Date();
    return this.save();
};

// Increment stats after a game
playerSchema.methods.recordGame = function (won, cardsPlayed = 0, eightsPlayed = 0) {
    this.stats.gamesPlayed += 1;
    if (won) {
        this.stats.gamesWon += 1;
    } else {
        this.stats.gamesLost += 1;
    }
    this.stats.totalCardsPlayed += cardsPlayed;
    this.stats.eightPlayed += eightsPlayed;
    this.lastActiveAt = new Date();
    return this.save();
};

module.exports = mongoose.model('Player', playerSchema);
