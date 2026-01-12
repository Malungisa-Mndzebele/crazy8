const mongoose = require('mongoose');

const connectDB = async () => {
    try {
        const mongoURI = process.env.MONGODB_URI;

        if (!mongoURI) {
            console.warn('⚠️  MONGODB_URI not set. Running without database persistence.');
            console.warn('   Set MONGODB_URI environment variable to enable player/game storage.');
            return false;
        }

        const conn = await mongoose.connect(mongoURI, {
            // Modern mongoose doesn't need these options anymore, but keeping for clarity
        });

        console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
        return true;
    } catch (error) {
        console.error(`❌ MongoDB Connection Error: ${error.message}`);
        // Don't crash the server - allow it to run without DB (in-memory mode)
        return false;
    }
};

module.exports = connectDB;
