
const mysql = require('mysql2/promise');
require('dotenv').config();

async function checkUsers() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || 'shiva',
        database: process.env.DB_NAME || 'poultrybillingdb',
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
    });

    try {
        const [rows] = await pool.query('SELECT * FROM Users');
        console.log('--- USERS TABLE ---');
        console.table(rows);
    } catch (err) {
        console.error('Error checking users:', err.message);
    } finally {
        await pool.end();
    }
}

checkUsers();
