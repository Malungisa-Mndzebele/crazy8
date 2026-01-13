const { DataTypes } = require('sequelize');
const { getSequelize } = require('../config/db');

let Player = null;

const initPlayerModel = () => {
    const sequelize = getSequelize();
    if (!sequelize) return null;

    Player = sequelize.define('Player', {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        username: {
            type: DataTypes.STRING(50),
            allowNull: false,
            unique: true
        },
        email: {
            type: DataTypes.STRING(255),
            allowNull: true
        },
        passwordHash: {
            type: DataTypes.STRING(255),
            allowNull: true
        },
        isGuest: {
            type: DataTypes.BOOLEAN,
            defaultValue: true
        },
        gamesPlayed: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        },
        gamesWon: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        },
        gamesLost: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        },
        totalCardsPlayed: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        },
        eightsPlayed: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        },
        lastActiveAt: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW
        }
    }, {
        tableName: 'players',
        timestamps: true // Adds createdAt, updatedAt
    });

    return Player;
};

const getPlayerModel = () => Player;

// Helper: Get or create a player
const getOrCreatePlayer = async (username) => {
    if (!Player) return null;

    try {
        const [player, created] = await Player.findOrCreate({
            where: { username },
            defaults: { isGuest: true }
        });

        if (created) {
            console.log(`👤 New guest player created: ${username}`);
        }

        return player;
    } catch (error) {
        console.error('Error with player lookup:', error.message);
        return null;
    }
};

// Helper: Record game result for a player
const recordGameResult = async (username, won) => {
    if (!Player) return;

    try {
        const player = await getOrCreatePlayer(username);
        if (player) {
            player.gamesPlayed += 1;
            if (won) {
                player.gamesWon += 1;
            } else {
                player.gamesLost += 1;
            }
            player.lastActiveAt = new Date();
            await player.save();
        }
    } catch (error) {
        console.error('Error recording game result:', error.message);
    }
};

// Get leaderboard
const getLeaderboard = async (limit = 10) => {
    if (!Player) return [];

    try {
        return await Player.findAll({
            where: {
                gamesPlayed: { [require('sequelize').Op.gt]: 0 }
            },
            order: [['gamesWon', 'DESC']],
            limit,
            attributes: ['username', 'gamesPlayed', 'gamesWon', 'gamesLost']
        });
    } catch (error) {
        console.error('Error fetching leaderboard:', error.message);
        return [];
    }
};

module.exports = {
    initPlayerModel,
    getPlayerModel,
    getOrCreatePlayer,
    recordGameResult,
    getLeaderboard
};
