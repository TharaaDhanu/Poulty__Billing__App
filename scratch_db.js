const mysql = require('mysql2/promise');
const pool = mysql.createPool({
    host: 'monorail.proxy.rlwy.net',
    user: 'root',
    password: 'tgnDJSHLDqtUhyUaHiANYdGVrBtMwcsW',
    database: 'railway',
    port: 46586
});

async function run() {
    try {
        const [rows] = await pool.query('SHOW TABLES');
        console.log("Tables:", rows);
        
        const [pRows] = await pool.query('SELECT * FROM Products');
        console.log("Products (capital P):", pRows);
        
        const [allTxn] = await pool.query('SELECT * FROM transactions');
        console.log("All transactions:", allTxn);

    } catch(e) {
        console.error(e);
    } finally {
        pool.end();
    }
}
run();
