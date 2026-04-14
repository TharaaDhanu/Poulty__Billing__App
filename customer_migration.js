const mysql = require('mysql2/promise');
const pool = mysql.createPool({ host: 'localhost', user: 'root', password: '', database: 'poultrybillingdb' });

async function run() {
    try {
        await pool.query('ALTER TABLE Customers ADD COLUMN IF NOT EXISTS total_orders INT DEFAULT 0');
        await pool.query('ALTER TABLE Customers ADD COLUMN IF NOT EXISTS total_spent DECIMAL(10,2) DEFAULT 0');
        await pool.query('ALTER TABLE Customers ADD COLUMN IF NOT EXISTS customer_type VARCHAR(20) DEFAULT "Regular"');
        console.log("Migration successful");
    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}
run();
