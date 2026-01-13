const { Sequelize } = require('sequelize');

let sequelize = null;
let dbConnected = false;

const connectDB = async () => {
    try {
        const databaseUrl = process.env.DATABASE_URL;

        if (!databaseUrl) {
            console.warn('⚠️  DATABASE_URL not set. Running without database persistence.');
            console.warn('   Create a PostgreSQL database on Render and set DATABASE_URL.');
            return false;
        }

        sequelize = new Sequelize(databaseUrl, {
            dialect: 'postgres',
            dialectOptions: {
                ssl: {
                    require: true,
                    rejectUnauthorized: false // Required for Render PostgreSQL
                }
            },
            logging: false // Set to console.log to debug SQL queries
        });

        await sequelize.authenticate();
        console.log('✅ PostgreSQL Connected');

        dbConnected = true;
        return true;
    } catch (error) {
        console.error(`❌ PostgreSQL Connection Error: ${error.message}`);
        return false;
    }
};

const getSequelize = () => sequelize;
const isConnected = () => dbConnected;

module.exports = { connectDB, getSequelize, isConnected };
