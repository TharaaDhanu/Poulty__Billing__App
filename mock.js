const mysql = require('mysql2/promise');
async function run() {
    const pool = mysql.createPool({host:'localhost', user:'root', password:'', database:'poultrybillingdb'});
    await pool.query("INSERT INTO products (Product_Name, Price, Stock_Quantity) VALUES ('Broiler Chicken (cut)', 200, 100)");
    const [p] = await pool.query("SELECT Product_ID FROM products WHERE Product_Name = 'Broiler Chicken (cut)' ORDER BY Product_ID DESC LIMIT 1");
    const id = p[0].Product_ID;
    await pool.query("INSERT INTO transactions (Customer_Name, Product_ID, Quantity, Total_Price) VALUES ('Test User', ?, 20.5, 4100)", [id]);
    console.log('Mock transaction inserted for product ID', id);
    process.exit();
}
run();
