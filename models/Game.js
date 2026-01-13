const { DataTypes } = require('sequelize');
const { getSequelize } = require('../config/db');

let Game = null;

const initGameModel = () => {
    const sequelize = getSequelize();
    if (!sequelize) return null;

    Game = sequelize.define('Game', {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        roomId: {
            type: DataTypes.STRING(20),
            allowNull: false,
            unique: true
        },
        status: {
            type: DataTypes.ENUM('waiting', 'in_progress', 'completed', 'abandoned'),
            defaultValue: 'waiting'
        },
        playerNames: {
            type: DataTypes.ARRAY(DataTypes.STRING),
            defaultValue: []
        },
        maxPlayers: {
            type: DataTypes.INTEGER,
            defaultValue: 4
        },
        winnerName: {
            type: DataTypes.STRING(50),
            allowNull: true
        },
        totalTurns: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        },
        startedAt: {
            type: DataTypes.DATE,
            allowNull: true
        },
        endedAt: {
            type: DataTypes.DATE,
            allowNull: true
        }
    }, {
        tableName: 'games',
        timestamps: true
    });

    return Game;
};

const getGameModel = () => Game;

// Save a completed game
const saveGameResult = async (room, winnerName) => {
    if (!Game) return null;

    try {
        const game = await Game.create({
            roomId: room.id,
            status: 'completed',
            playerNames: room.players.map(p => p.name),
            maxPlayers: room.maxPlayers,
            winnerName,
            startedAt: room.startedAt || new Date(),
            endedAt: new Date()
        });

        console.log(`📊 Game ${room.id} saved to database. Winner: ${winnerName}`);
        return game;
    } catch (error) {
        console.error('Failed to save game:', error.message);
        return null;
    }
};

// Get recent games
const getRecentGames = async (limit = 10) => {
    if (!Game) return [];

    try {
        return await Game.findAll({
            where: { status: 'completed' },
            order: [['endedAt', 'DESC']],
            limit,
            attributes: ['roomId', 'playerNames', 'winnerName', 'endedAt']
        });
    } catch (error) {
        console.error('Error fetching recent games:', error.message);
        return [];
    }
};

module.exports = {
    initGameModel,
    getGameModel,
    saveGameResult,
    getRecentGames
};
