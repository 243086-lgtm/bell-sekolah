const mysql = require('mysql2/promise');

async function initializeDatabase() {
    try {
        // Connect without database selected to create it first
        const connection = await mysql.createConnection({
            host: 'localhost',
            user: 'root',
            password: ''
        });

        console.log('Connected to MySQL server.');

        await connection.query("CREATE DATABASE IF NOT EXISTS bellmaster_db");
        console.log('Database bellmaster_db checked/created.');

        await connection.query("USE bellmaster_db");

        // Create schedules table
        await connection.query(`
            CREATE TABLE IF NOT EXISTS schedules (
                id VARCHAR(50) PRIMARY KEY,
                day VARCHAR(20) NOT NULL,
                time VARCHAR(10) NOT NULL,
                name VARCHAR(100) NOT NULL,
                soundId VARCHAR(50) NOT NULL
            )
        `);
        console.log('Table schedules checked/created.');

        // Create custom_sounds table
        await connection.query(`
            CREATE TABLE IF NOT EXISTS custom_sounds (
                id VARCHAR(50) PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                path VARCHAR(255) NOT NULL,
                original_name VARCHAR(255) NOT NULL
            )
        `);
        console.log('Table custom_sounds checked/created.');

        // Create settings table
        await connection.query(`
            CREATE TABLE IF NOT EXISTS settings (
                setting_key VARCHAR(50) PRIMARY KEY,
                setting_value TEXT
            )
        `);
        console.log('Table settings checked/created.');

        // Create log table
        await connection.query(`
            CREATE TABLE IF NOT EXISTS logs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                message TEXT,
                type VARCHAR(20),
                time VARCHAR(20),
                date VARCHAR(50),
                ts BIGINT
            )
        `);
        console.log('Table logs checked/created.');

        await connection.end();
        console.log('Database initialization completed successfully.');
    } catch (error) {
        console.error('Error initializing database:', error);
    }
}

initializeDatabase();
