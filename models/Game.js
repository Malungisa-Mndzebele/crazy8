const mongoose = require('mongoose');

const gameSchema = new mongoose.Schema({
    roomId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    status: {
        type: String,
        enum: ['waiting', 'in_progress', 'completed', 'abandoned'],
        default: 'waiting'
    },
    players: [{
        odId: String, // Socket ID during game
        playerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Player' },
        name: String,
        isHost: { type: Boolean, default: false },
        cardsPlayedCount: { type: Number, default: 0 },
        eightsPlayedCount: { type: Number, default: 0 },
        finalHandSize: { type: Number, default: 0 },
        joinedAt: { type: Date, default: Date.now }
    }],
    maxPlayers: {
        type: Number,
        default: 4,
        min: 2,
        max: 8
    },
    winner: {
        playerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Player' },
        name: String
    },
    gameStats: {
        totalTurns: { type: Number, default: 0 },
        totalCardsDrawn: { type: Number, default: 0 },
        totalEightsPlayed: { type: Number, default: 0 },
        directionChanges: { type: Number, default: 0 }, // Jacks played
        skipsIssued: { type: Number, default: 0 }, // Sevens played
        penaltiesIssued: { type: Number, default: 0 } // Twos played
    },
    startedAt: {
        type: Date
    },
    endedAt: {
        type: Date
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Virtual for game duration
gameSchema.virtual('duration').get(function () {
    if (!this.startedAt || !this.endedAt) return null;
    return Math.round((this.endedAt - this.startedAt) / 1000); // Duration in seconds
});

// Start the game
gameSchema.methods.startGame = function () {
    this.status = 'in_progress';
    this.startedAt = new Date();
    return this.save();
};

// End the game with a winner
gameSchema.methods.endGame = function (winnerSocketId, winnerName, winnerId = null) {
    this.status = 'completed';
    this.endedAt = new Date();
    this.winner = {
        playerId: winnerId,
        name: winnerName
    };
    return this.save();
};

// Abandon the game
gameSchema.methods.abandon = function () {
    this.status = 'abandoned';
    this.endedAt = new Date();
    return this.save();
};

// Leaderboard aggregation
gameSchema.statics.getLeaderboard = async function (limit = 10) {
    const Player = mongoose.model('Player');
    return Player.find({ 'stats.gamesPlayed': { $gt: 0 } })
        .sort({ 'stats.gamesWon': -1 })
        .limit(limit)
        .select('username stats.gamesPlayed stats.gamesWon stats.gamesLost');
};

module.exports = mongoose.model('Game', gameSchema);
