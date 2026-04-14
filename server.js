const express = require('express');
const mysql   = require('mysql2/promise');
const cors    = require('cors');
const jwt     = require('jsonwebtoken');
const bcrypt  = require('bcrypt');
const PDFDocument = require('pdfkit-table');
const exceljs = require('exceljs');
const app     = express();
const JWT_SECRET = 'super_secret_poultry_key';
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname)); // Serve static files (HTML, JS, CSS)

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// Middleware for Authentication
const verifyToken = (req, res, next) => {
    // JWT TEMPORARILY DISABLED as requested
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        req.user = { role: token };
    } else {
        req.user = null;
    }
    next();
};

const verifyRole = (roles) => {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Forbidden: Insufficient privileges' });
        }
        next();
    };
};

const pool = mysql.createPool({
    host: 'monorail.proxy.rlwy.net',
    user: 'root',
    password: 'tgnDJSHLDqtUhyUaHiANYdGVrBtMwcsW',
    database: 'railway',
    port: 46586
});

pool.getConnection()
    .then(async (conn) => {
        console.log("✅ MySQL Database Connected!");
        conn.release();
        // Auto-migrate: ensure all required columns & tables exist
        try {
            await pool.query(`ALTER TABLE transactions DROP FOREIGN KEY transactions_ibfk_1`);
            await pool.query(`ALTER TABLE transactions ADD CONSTRAINT transactions_ibfk_1 FOREIGN KEY (Product_ID) REFERENCES Products(Product_ID) ON DELETE SET NULL`);
            console.log('  ✔ transactions ON DELETE SET NULL applied');
        } catch(e) { console.log('  ⚠ transactions FK update skipped:', e.message); }
        
        try {
            await pool.query(`ALTER TABLE Wastage DROP FOREIGN KEY wastage_ibfk_1`);
            await pool.query(`ALTER TABLE Wastage ADD CONSTRAINT wastage_ibfk_1 FOREIGN KEY (Product_ID) REFERENCES Products(Product_ID) ON DELETE SET NULL`);
        } catch(e) {}
        
        try {
            // STEP 1: Reset Users Table (Lowercase as requested)
            await pool.query(`CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                role VARCHAR(50) DEFAULT 'admin'
            )`);
            
            // Delete old data and insert clean users
            await pool.query(`DELETE FROM users`);
            await pool.query(`INSERT INTO users (username, password, role) VALUES (?, ?, ?), (?, ?, ?)`, 
                ['admin', 'admin123', 'admin', 'staff', 'staff123', 'staff']);
                
            console.log('  ✔ Plain-text users table reset and seeded');
        } catch(e) { console.error('  ⚠ Users setup failed:', e.message); }
        
        try {
            await pool.query(`USE poultrybillingdb`);
            console.log("Ensuring wastage table...");
            await pool.query(`CREATE TABLE IF NOT EXISTS wastage (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_name VARCHAR(255),
  processed_quantity DECIMAL(10,2),
  predicted_wastage DECIMAL(10,2),
  estimated_loss DECIMAL(10,2),
  source VARCHAR(50),
  date DATE DEFAULT (CURRENT_DATE),
  time TIME DEFAULT (CURRENT_TIME)
) ENGINE=InnoDB`);
            console.log('  ✔ Wastage table ensured (no drop)');
            
            // Add time column if missing (for existing tables)
            try {
                await pool.query(`ALTER TABLE wastage ADD COLUMN IF NOT EXISTS time TIME DEFAULT (CURRENT_TIME)`);
                console.log('  ✔ Wastage.time column ensured');
            } catch(e) { console.log('  ⚠ Wastage.time column already exists or skipped'); }
            
            try {
                await pool.query(`CREATE INDEX idx_wastage_date ON wastage(date)`);
            } catch(e) {}
        } catch(e) { console.log('  ⚠ Wastage table check skipped:', e.message); }

        try {
            console.log("Checking wastage columns...");
            await pool.query(`SHOW COLUMNS FROM wastage`);
            
            await pool.query(`ALTER TABLE Wastage ADD COLUMN IF NOT EXISTS Loss_Amount DECIMAL(10,2) DEFAULT 0`);
            await pool.query(`ALTER TABLE wastage ADD COLUMN IF NOT EXISTS Date TIMESTAMP DEFAULT CURRENT_TIMESTAMP`);
            await pool.query(`ALTER TABLE wastage ADD COLUMN IF NOT EXISTS Source VARCHAR(50) DEFAULT 'MANUAL'`);
            await pool.query(`ALTER TABLE wastage ADD COLUMN IF NOT EXISTS Product_ID INT`);
            await pool.query(`ALTER TABLE wastage ADD COLUMN IF NOT EXISTS Quantity DECIMAL(10,2)`);
            await pool.query(`ALTER TABLE wastage ADD COLUMN IF NOT EXISTS Reason VARCHAR(255)`);
            console.log('  ✔ Wastage columns ensured');
        } catch(e) { console.log('  ⚠ Wastage column checks skipped:', e.message); }
        try {
            await pool.query(`ALTER TABLE Products ADD COLUMN IF NOT EXISTS unit VARCHAR(20) DEFAULT 'kg'`);
            // Auto-assign units based on product name for existing records
            await pool.query(`UPDATE Products SET unit = 'pcs' WHERE (LOWER(Product_Name) LIKE '%egg%' OR LOWER(Product_Name) LIKE '%masala egg%') AND (unit IS NULL OR unit = 'kg')`);
            await pool.query(`UPDATE Products SET unit = 'kg' WHERE unit IS NULL`);
            console.log('  ✔ Products.unit column ensured');
        } catch(e) { console.log('  ⚠ Products.unit check skipped:', e.message); }
        try {
            await pool.query(`ALTER TABLE Products ADD COLUMN IF NOT EXISTS Low_Stock_Threshold DECIMAL(10,2) DEFAULT 5`);
            console.log('  ✔ Products.Low_Stock_Threshold column ensured');
        } catch(e) { console.log('  ⚠ Products.Low_Stock_Threshold check skipped:', e.message); }
        try {
            await pool.query(`CREATE TABLE IF NOT EXISTS Customers (
                Customer_ID INT AUTO_INCREMENT PRIMARY KEY,
                Customer_Name VARCHAR(255) NOT NULL,
                Phone VARCHAR(20) DEFAULT '',
                Address VARCHAR(255) DEFAULT '',
                Created_At TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`);
            console.log('  ✔ Customers table ensured');

            await pool.query('ALTER TABLE Customers ADD COLUMN IF NOT EXISTS total_orders INT DEFAULT 0');
            await pool.query('ALTER TABLE Customers ADD COLUMN IF NOT EXISTS total_spent DECIMAL(10,2) DEFAULT 0');
            await pool.query('ALTER TABLE Customers ADD COLUMN IF NOT EXISTS customer_type VARCHAR(20) DEFAULT "Regular"');
            
            await pool.query(`
              UPDATE Customers c
              LEFT JOIN (
                SELECT Customer_Name, 
                       COUNT(*) AS total_orders,
                       SUM(Total_Amount) AS total_spent
                FROM bills
                GROUP BY Customer_Name
              ) t ON c.Customer_Name = t.Customer_Name
              SET 
                c.total_orders = IFNULL(t.total_orders, 0),
                c.total_spent = IFNULL(t.total_spent, 0)
            `);
            console.log('  ✔ Customers total_orders and total_spent synced from bills');
        } catch(e) { console.log('  ⚠ Customers table/sync skipped:', e.message); }
        try {
            await pool.query(`CREATE TABLE IF NOT EXISTS Khata (
                Khata_ID INT AUTO_INCREMENT PRIMARY KEY,
                Customer_Name VARCHAR(255) NOT NULL,
                Phone VARCHAR(20) DEFAULT '',
                Credit_Limit DECIMAL(10,2) DEFAULT 5000.00,
                Amount_Due DECIMAL(10,2) DEFAULT 0.00,
                Last_Updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )`);
            console.log('  ✔ Khata table ensured');
        } catch(e) { console.log('  ⚠ Khata table check skipped:', e.message); }
        try {
            await pool.query(`CREATE TABLE IF NOT EXISTS Khata_Transactions (
                Txn_ID INT AUTO_INCREMENT PRIMARY KEY,
                Khata_ID INT NOT NULL,
                Bill_Amount DECIMAL(10,2) DEFAULT 0.00,
                Payment_Amount DECIMAL(10,2) DEFAULT 0.00,
                Note VARCHAR(255) DEFAULT '',
                Txn_Date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (Khata_ID) REFERENCES Khata(Khata_ID) ON DELETE CASCADE
            )`);
            console.log('  ✔ Khata_Transactions table ensured');
        } catch(e) { console.log('  ⚠ Khata_Transactions table check skipped:', e.message); }
        try {
            await pool.query(`CREATE TABLE IF NOT EXISTS Shop_Settings (
                id INT AUTO_INCREMENT PRIMARY KEY,
                shop_name VARCHAR(255) DEFAULT 'POULTRY PRO SHOP',
                owner_name VARCHAR(255) DEFAULT '',
                address VARCHAR(500) DEFAULT '',
                phone VARCHAR(50) DEFAULT '',
                email VARCHAR(255) DEFAULT '',
                gst_number VARCHAR(50) DEFAULT '',
                logo_url VARCHAR(500) DEFAULT ''
            )`);
            console.log('  ✔ Shop_Settings table ensured');
        } catch(e) { console.log('  ⚠ Shop_Settings table check skipped:', e.message); }
        console.log('✅ Auto-migration complete.');
    })
    .catch(err => console.error("❌ MySQL Connection Failed:", err.message));

// ═══════════════════════════════════════════════
// SQL SETUP — run once to create new columns/tables
// ALTER TABLE Products ADD COLUMN IF NOT EXISTS Low_Stock_Threshold DECIMAL(10,2) DEFAULT 5;
// CREATE TABLE IF NOT EXISTS Khata (
//   Khata_ID INT AUTO_INCREMENT PRIMARY KEY,
//   Customer_Name VARCHAR(255),
//   Phone VARCHAR(20),
//   Credit_Limit DECIMAL(10,2) DEFAULT 5000,
//   Amount_Due DECIMAL(10,2) DEFAULT 0,
//   Last_Updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
// );
// CREATE TABLE IF NOT EXISTS Khata_Transactions (
//   Txn_ID INT AUTO_INCREMENT PRIMARY KEY,
//   Khata_ID INT,
//   Bill_Amount DECIMAL(10,2),
//   Payment_Amount DECIMAL(10,2) DEFAULT 0,
//   Note VARCHAR(255),
//   Txn_Date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
//   FOREIGN KEY (Khata_ID) REFERENCES Khata(Khata_ID)
// );
// ═══════════════════════════════════════════════

// ── 1. LOGIN ──────────────────────────────────
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  console.log("Login request:", username, password);

  try {
    const [rows] = await pool.query(
      "SELECT * FROM users WHERE username = ?", 
      [username]
    );

    if (rows.length === 0) {
      console.log("User not found:", username);
      return res.status(401).json({ success: false, message: "User not found" });
    }

    const user = rows[0];
    // Handle both capitalized and lowercase column names from MySQL
    const dbPassword = user.password || user.Password;
    const dbRole = user.role || user.Role;
    const dbId = user.id || user.ID;
    const dbUsername = user.username || user.Username;
    console.log("User from DB:", user);
    console.log("Password match:", dbPassword === password);

    // SIMPLE PASSWORD CHECK (NO BCRYPT)
    if (dbPassword !== password) {
      return res.status(401).json({ success: false, message: "Invalid password" });
    }

    return res.json({
      success: true,
      role: dbRole,
      message: "Login successful",
      // Include user object for SPA compatibility
      user: { id: dbId, username: dbUsername, role: dbRole }
    });
  } catch (err) {
    console.error("Login Error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ── 2. CUSTOMER CRUD ───────────────────────────
app.post('/add-customer', verifyToken, async (req, res) => {
    const { Name, Phone, Address } = req.body;
    try {
        await pool.query("INSERT INTO Customers (Customer_Name, Phone, Address) VALUES (?, ?, ?)", [Name, Phone, Address]);
        res.json({ success: true, message: "Customer Added Successfully" });
    } catch (err) { res.status(500).json({ success: false, message: "Error adding customer" }); }
});

app.get('/customers', verifyToken, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM Customers ORDER BY total_orders DESC');
        res.json(rows);
    } catch (err) { res.status(500).send('Error fetching customers'); }
});

app.get('/api/customers/search', verifyToken, async (req, res) => {
  const search = req.query.q || '';
  try {
    const [rows] = await pool.query(
      "SELECT * FROM Customers WHERE Customer_Name LIKE ? OR Phone LIKE ? ORDER BY Customer_Name ASC",
      [`%${search}%`, `%${search}%`]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: "Error searching customers" });
  }
});

app.put('/customers/:id', verifyToken, async (req, res) => {
    const { id } = req.params;
    const { Name, Phone, Address } = req.body;
    try {
        await pool.query('UPDATE Customers SET Customer_Name = ?, Phone = ?, Address = ? WHERE Customer_ID = ?', [Name, Phone, Address, id]);
        res.json({ success: true, message: 'Customer Updated' });
    } catch (err) { res.status(500).send('Error updating customer'); }
});

app.delete('/customers/:id', verifyToken, verifyRole(['admin']), async (req, res) => {
    const { id } = req.params;
    try {
        // Check if customer has unpaid khata
        const [customer] = await pool.query('SELECT Customer_Name FROM Customers WHERE Customer_ID = ?', [id]);
        if (customer.length > 0) {
            const [khata] = await pool.query('SELECT Khata_ID, Amount_Due FROM Khata WHERE Customer_Name = ?', [customer[0].Customer_Name]);
            if (khata.length > 0 && parseFloat(khata[0].Amount_Due) > 0) {
                return res.status(400).json({ success: false, message: 'Cannot delete customer with unpaid Khata balance (₹' + khata[0].Amount_Due + ')' });
            }
        }
        const [result] = await pool.query('DELETE FROM Customers WHERE Customer_ID = ?', [id]);
        if (result.affectedRows > 0) res.json({ success: true, message: 'Customer Deleted' });
        else res.status(404).json({ success: false, message: 'Customer not found' });
    } catch (err) {
        if (err.code === 'ER_ROW_IS_REFERENCED_2') {
            return res.status(400).json({ success: false, message: 'Cannot delete customer as they are linked to existing records.' });
        }
        res.status(500).json({ success: false, message: 'Error deleting customer' });
    }
});

// ── 3. ADD PRODUCT (with threshold + unit) ───────────
app.post('/add-product', verifyToken, verifyRole(['admin']), async (req, res) => {
    const { name, price, stock, threshold, unit } = req.body;
    if (!name || !price || !stock) return res.status(400).json({ success: false, message: "All fields required!" });
    // Auto-detect unit if not provided
    const nameLower = (name || '').toLowerCase();
    let resolvedUnit = unit || 'kg';
    if (!unit) {
        if (nameLower.includes('egg')) resolvedUnit = 'pcs';
        else if (nameLower.includes('chicken') || nameLower.includes('hen') || nameLower.includes('meat') || nameLower.includes('mutton')) resolvedUnit = 'kg';
    }
    try {
        const [result] = await pool.query(
            "INSERT INTO Products (Product_Name, Price, Stock_Quantity, Low_Stock_Threshold, unit) VALUES (?, ?, ?, ?, ?)",
            [name, price, stock, threshold || 5, resolvedUnit]
        );
        res.status(200).json({ success: true, message: "Product added!", id: result.insertId });
    } catch (err) {
        // Fallback if unit column doesn't exist yet
        try {
            const [result] = await pool.query(
                "INSERT INTO Products (Product_Name, Price, Stock_Quantity, Low_Stock_Threshold) VALUES (?, ?, ?, ?)",
                [name, price, stock, threshold || 5]
            );
            res.status(200).json({ success: true, message: "Product added!", id: result.insertId });
        } catch(e) {
            console.error('Add Product Error:', e);
            res.status(500).json({ success: false, message: "Failed to add product." });
        }
    }
});

// ── 4. GET ALL PRODUCTS ───────────────────────
app.get('/products', verifyToken, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT Product_ID, Product_Name, Price AS Price_Per_Kg, Stock_Quantity, Low_Stock_Threshold, COALESCE(unit, "kg") AS unit FROM Products');
        res.json(rows);
    } catch (err) {
        // Fallback without threshold/unit
        try {
            const [rows] = await pool.query('SELECT Product_ID, Product_Name, Price AS Price_Per_Kg, Stock_Quantity FROM Products');
            res.json(rows.map(r => ({ ...r, unit: 'kg' })));
        } catch(e) { res.status(500).send('Error fetching products'); }
    }
});

// ── 5. GET FREQUENT CUSTOMERS ─────────────────
app.get('/frequent-customers', verifyToken, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM Customers WHERE total_orders >= 5 ORDER BY total_orders DESC');
        res.json(rows);
    } catch (err) { res.status(500).send('Error fetching frequent customers'); }
});

// endpoint removed

// ── 6. GENERATE BILL (pay now or khata) ───────
app.post('/generate-bill-bulk', verifyToken, async (req, res) => {
    const { CustomerName, Items, TotalAmount, PaymentType, KhataID, Phone } = req.body;
    try {
        const [result] = await pool.query(
            'INSERT INTO bills (Customer_Name, Total_Amount) VALUES (?, ?)',
            [CustomerName, TotalAmount]
        );
        const billId = result.insertId; // Capture the real Bill_ID
        for (const item of Items) {
            await pool.query(
                'UPDATE products SET Stock_Quantity = Stock_Quantity - ? WHERE Product_ID = ?',
                [item.qty, item.id]
            );
            await pool.query(
                'INSERT INTO transactions (Customer_Name, Product_ID, Quantity, Total_Price) VALUES (?, ?, ?, ?)',
                [CustomerName, item.id, item.qty, item.total]
            );
        }
        // If Pay Later — record in Khata
        if (PaymentType === 'khata') {
            if (KhataID) {
                await pool.query(
                    'UPDATE Khata SET Amount_Due = Amount_Due + ? WHERE Khata_ID = ?',
                    [TotalAmount, KhataID]
                );
                await pool.query(
                    'INSERT INTO Khata_Transactions (Khata_ID, Bill_Amount, Note) VALUES (?, ?, ?)',
                    [KhataID, TotalAmount, `Bill #${billId} for ${CustomerName}`]
                );
            } else {
                // Create new khata entry
                const [k] = await pool.query(
                    'INSERT INTO Khata (Customer_Name, Phone, Amount_Due) VALUES (?, ?, ?)',
                    [CustomerName, Phone || '', TotalAmount]
                );
                await pool.query(
                    'INSERT INTO Khata_Transactions (Khata_ID, Bill_Amount, Note) VALUES (?, ?, ?)',
                    [k.insertId, TotalAmount, `Bill #${billId} for ${CustomerName}`]
                );
            }
        }
        
        // CUSTOMER LOYALTY UPDATE
        if (CustomerName && CustomerName !== 'Walk-in Customer') {
            try {
                await pool.query(
                    'UPDATE Customers SET total_orders = total_orders + 1, total_spent = total_spent + ? WHERE Customer_Name = ?',
                    [TotalAmount, CustomerName]
                );
            } catch (err) { console.error('Error updating customer loyalty:', err); }
        }

        res.status(200).json({ success: true, billId: billId });
    } catch (err) {
        console.error(err);
        res.status(500).send("Database Error");
    }
});

app.get('/api/wastage', verifyToken, verifyRole(['admin']), async (req, res) => {
  try {
    const { date } = req.query;

    let query = "SELECT * FROM wastage";
    let values = [];

    if (date) {
      query += " WHERE DATE(date) = DATE(?)";
      values.push(date);
    }

    query += " ORDER BY date DESC";

    const [rows] = await pool.query(query, values);

    console.log("Wastage Data:", rows.length, "records");

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch wastage" });
  }
});

app.post('/api/wastage', verifyToken, verifyRole(['admin']), async (req, res) => {
    const { product_name, processed_quantity, predicted_wastage, estimated_loss, date } = req.body;
    try {
        if (date) {
            await pool.query(
                'INSERT INTO wastage (product_name, processed_quantity, predicted_wastage, estimated_loss, date) VALUES (?, ?, ?, ?, ?)',
                [product_name, processed_quantity, predicted_wastage, estimated_loss, date]
            );
        } else {
            // Note: date defaults to CURRENT_TIMESTAMP from our alter table
            await pool.query(
                'INSERT INTO wastage (product_name, processed_quantity, predicted_wastage, estimated_loss) VALUES (?, ?, ?, ?)',
                [product_name, processed_quantity, predicted_wastage, estimated_loss]
            );
        }
        console.log('Wastage saved:', { product_name, processed_quantity, predicted_wastage, estimated_loss, date });
        res.json({ success: true, message: 'Wastage Recorded' });
    } catch (err) {
        console.error('Wastage Error:', err);
        res.status(500).send('Error recording wastage');
    }
});

app.post('/log-wastage', verifyToken, verifyRole(['admin']), async (req, res) => {
    const { ProductID, Quantity, Reason, LossAmount } = req.body;
    try {
        await pool.query('INSERT INTO wastage (Product_ID, Quantity, Reason, Loss_Amount) VALUES (?, ?, ?, ?)', [ProductID, Quantity, Reason, LossAmount]);
        res.json({ success: true, message: "Wastage logged!" });
    } catch (err) { res.status(500).send("Error saving wastage"); }
});

app.post('/wastage/predict', verifyToken, verifyRole(['admin']), async (req, res) => {
    const { product_name, quantity } = req.body;
    if (!product_name || !quantity || isNaN(quantity)) {
        return res.status(400).json({ success: false, message: 'Missing product_name or valid quantity.' });
    }
    const product = product_name.toLowerCase();
    let wastage = 0;

    if (product.includes('chicken') || product.includes('hen')) {
        wastage = quantity * 0.4;
    } else if (product.includes('egg')) {
        wastage = quantity * 0.03;
    } else if (product.includes('meat') || product.includes('mutton') || product.includes('beef') || product.includes('pork')) {
        wastage = quantity * 0.10;
    } else {
        wastage = quantity * 0.05; // fallback
    }

    res.json({ success: true, predicted_wastage: parseFloat(wastage.toFixed(2)) });
});

app.get('/wastage/predict-auto', verifyToken, verifyRole(['admin']), async (req, res) => {
    const { product_id, product_name } = req.query;
    if (!product_id || !product_name) {
        return res.status(400).json({ success: false, message: 'Missing product_id or product_name.' });
    }

    try {
        console.log("Selected product:", product_name);
        console.log("Mapped product_id:", product_id);

        let total_sold = 0;
        
        // Remove date filter for now to debug
        const [todayRows] = await pool.query(
            `SELECT COALESCE(SUM(Quantity), 0) AS total_sold FROM transactions WHERE Product_ID = ?`,
            [product_id]
        );

        total_sold = parseFloat(todayRows[0].total_sold) || 0;

        console.log("Total sold:", total_sold);
        const processed_quantity = total_sold;
        console.log("Processed quantity:", processed_quantity);

        const product = product_name.toLowerCase();
        let wastage = 0;

        if (product.includes('chicken') || product.includes('hen')) {
            wastage = total_sold * 0.4;
        } else if (product.includes('egg')) {
            wastage = total_sold * 0.03;
        } else if (product.includes('meat') || product.includes('mutton') || product.includes('beef') || product.includes('pork')) {
            wastage = total_sold * 0.10;
        } else {
            wastage = total_sold * 0.05; // fallback
        }

        res.json({
            success: true,
            product: product_name,
            processed_quantity: parseFloat(total_sold.toFixed(2)),
            predicted_wastage: parseFloat(wastage.toFixed(2))
        });
    } catch (err) {
        console.error('Auto predict error:', err);
        res.status(500).json({ success: false, message: 'Database error fetching auto processed quantity.' });
    }
});

// ── 7.5 DAILY SOLD INVENTORY ─────────────────────
app.get('/transactions/daily-sold', verifyToken, async (req, res) => {
    try {
        const { date } = req.query;
        const dateFilter = date ? '?' : null;
        const query = `
            SELECT p.Product_Name as product_name, p.Product_ID as product_id, SUM(t.Quantity) AS total_sold
            FROM transactions t
            JOIN products p ON t.Product_ID = p.Product_ID
            WHERE DATE(t.Transaction_Date) = ${date ? '?' : 'CURDATE()'}
            GROUP BY p.Product_ID, p.Product_Name
            ORDER BY total_sold DESC
        `;
        const params = date ? [date] : [];
        const [rows] = await pool.query(query, params);
        res.json(rows);
    } catch (err) {
        console.error('Error fetching daily sold:', err);
        res.status(500).json({ success: false, message: 'Database error fetching daily sold products' });
    }
});

// ── 8. SALES REPORT ───────────────────────────
app.get('/sales-report', verifyToken, async (req, res) => {
    let { date, startDate, endDate } = req.query;
    let whereQuery = '';
    let params = [];
    
    if (startDate && endDate) {
        whereQuery = ' WHERE DATE(Date) BETWEEN ? AND ?';
        params.push(startDate, endDate);
    } else if (date) {
        whereQuery = ' WHERE DATE(Date) = ?';
        params.push(date);
    } else {
        whereQuery = ' WHERE DATE(Date) = CURDATE()';
    }
    
    try {
        const [salesRows] = await pool.query(`SELECT SUM(Total_Amount) as Totalsales FROM bills${whereQuery}`, params);
        const [wasteRows] = await pool.query(`SELECT SUM(estimated_loss) as TotalWaste FROM wastage${whereQuery}`, params);
        const totalSales = parseFloat(salesRows[0].Totalsales) || 0;
        const totalWaste = parseFloat(wasteRows[0].TotalWaste) || 0;
        res.json({ Totalsales: totalSales, TotalWaste: totalWaste, Profit: totalSales - totalWaste });
    } catch (err) { res.json({ Totalsales: 0, TotalWaste: 0, Profit: 0 }); }
});

// ── 9. DATE-WISE SALES ────────────────────────
app.get('/sales-report-date', verifyToken, async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT * FROM (
                SELECT DATE(Date) as date, SUM(Total_Amount) as totalSales 
                FROM bills 
                GROUP BY DATE(Date) 
                ORDER BY date DESC 
                LIMIT 7
            ) sub ORDER BY date ASC
        `);
        res.json(rows);
    } catch (err) { res.status(500).send('Error fetching chart data'); }
});

// ── 10. DETAILED SALES REPORT (per product) ───
app.get('/sales-detail', verifyToken, async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT b.Customer_Name, b.Total_Amount, b.Date,
                   COALESCE(p.Product_Name, 'Deleted Product') as Product_Name, p.Stock_Quantity as Remaining_Stock
            FROM bills b
            LEFT JOIN products p ON 1=1
            GROUP BY b.Bill_ID, p.Product_ID
            ORDER BY b.Date DESC LIMIT 50
        `);
        res.json(rows);
    } catch (err) {
        // Simpler fallback
        try {
            const [rows] = await pool.query(`SELECT Customer_Name, Total_Amount, Date FROM bills ORDER BY Date DESC LIMIT 50`);
            res.json(rows);
        } catch(e) { res.status(500).send('Error'); }
    }
});

// ── 11. BILLS WITH CUSTOMERS ──────────────────
app.get('/bills-report', verifyToken, async (req, res) => {
    try {
        const { date, startDate, endDate } = req.query; // optional
        let query = `
            SELECT b.Bill_ID, b.Customer_Name, b.Total_Amount, b.Date,
                   c.Phone
            FROM bills b
            LEFT JOIN Customers c ON c.Customer_Name = b.Customer_Name
        `;
        let params = [];
        if (startDate && endDate) {
            query += ' WHERE DATE(b.Date) BETWEEN ? AND ? ORDER BY b.Date DESC';
            params.push(startDate, endDate);
        } else if (date) {
            query += ' WHERE DATE(b.Date) = ? ORDER BY b.Date DESC';
            params.push(date);
        } else {
            query += ' WHERE DATE(b.Date) = CURDATE() ORDER BY b.Date DESC LIMIT 100';
        }
        
        const [rows] = await pool.query(query, params);
        res.json(rows);
    } catch (err) {
        try {
            const [rows] = await pool.query('SELECT * FROM bills ORDER BY Date DESC LIMIT 100');
            res.json(rows);
        } catch(e) { res.status(500).send('Error'); }
    }
});

// ── 11.5. DOWNLOAD REPORT (CSV/PDF/EXCEL) ────────────────
app.get('/reports/download', verifyToken, async (req, res) => {
    try {
        const { type, date, startDate, endDate, format } = req.query;
        let whereQueryBills = '';
        let whereQueryWaste = '';
        let params = [];

        if (startDate && endDate && type !== 'daily') {
            whereQueryBills = ' WHERE DATE(b.Date) BETWEEN ? AND ?';
            whereQueryWaste = ' WHERE DATE(Date) BETWEEN ? AND ?';
            params.push(startDate, endDate);
        } else if (date) {
            whereQueryBills = ' WHERE DATE(b.Date) = ?';
            whereQueryWaste = ' WHERE DATE(Date) = ?';
            params.push(date);
        } else {
            whereQueryBills = ' WHERE DATE(b.Date) = CURDATE()';
            whereQueryWaste = ' WHERE DATE(Date) = CURDATE()';
        }

        // Fetch aggregates
        const [salesRows] = await pool.query(`SELECT SUM(Total_Amount) as Totalsales FROM bills b${whereQueryBills}`, params);
        const [wasteRows] = await pool.query(`SELECT SUM(estimated_loss) as TotalWaste FROM wastage${whereQueryWaste}`, params);
        const totalSales = parseFloat(salesRows[0].Totalsales) || 0;
        const totalWaste = parseFloat(wasteRows[0].TotalWaste) || 0;
        const netProfit = totalSales - totalWaste;

        // Fetch transactions
        let query = `
            SELECT b.Bill_ID, b.Customer_Name, b.Total_Amount, b.Date
            FROM bills b
            ${whereQueryBills}
            ORDER BY b.Date DESC
        `;
        const [transactions] = await pool.query(query, params);

        const [wastageList] = await pool.query(`SELECT * FROM wastage ${whereQueryWaste} ORDER BY date DESC`, params);

        // Fetch Shop Settings
        const [shopRows] = await pool.query('SELECT shop_name FROM Shop_Settings LIMIT 1');
        const shopName = shopRows.length ? shopRows[0].shop_name : 'Poultry Shop';
        const docTitle = `${shopName} - Sales Report`;
        const periodStr = startDate && endDate && type !== 'daily' ? `${startDate} to ${endDate}` : (date || new Date().toISOString().split('T')[0]);

        let filename = `sales_report_${type || 'daily'}_${date || new Date().toISOString().split('T')[0]}`;
        if (startDate && endDate && type !== 'daily') {
            filename = `sales_report_${type}_${startDate}_to_${endDate}`;
        }

        if (format === 'pdf') {
            const doc = new PDFDocument({ margin: 30, size: 'A4' });
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
            doc.pipe(res);

            doc.fontSize(20).text(docTitle, { align: 'center' });
            doc.fontSize(12).text(`Report Type: ${(type || 'daily').toUpperCase()}`, { align: 'center' });
            doc.text(`Period: ${periodStr}`, { align: 'center' });
            doc.moveDown();

            doc.fontSize(14).text('Summary');
            doc.fontSize(12);
            doc.text(`Total Sales: Rs. ${totalSales.toFixed(2)}`);
            doc.text(`Total Wastage: Rs. ${totalWaste.toFixed(2)}`);
            doc.text(`Net Profit: Rs. ${netProfit.toFixed(2)}`);
            doc.moveDown();

            const tableArray = {
                title: "Transactions",
                headers: ["Bill No", "Customer", "Date", "Amount"],
                rows: transactions.map(t => [
                    t.Bill_ID.toString(),
                    t.Customer_Name || 'Walk-in',
                    new Date(t.Date).toLocaleString('en-IN'),
                    `Rs. ${parseFloat(t.Total_Amount).toFixed(2)}`
                ])
            };
            if (transactions.length > 0) {
                await doc.table(tableArray, { width: 500 });
            } else {
                doc.text("No transactions found.");
            }
            doc.moveDown();

            const wasteArray = {
                title: "Wastage Entries",
                headers: ["Product", "Quantity", "Expense Amount", "Date", "Time"],
                rows: wastageList.map(w => {
                    return [
                        w.product_name || 'Unknown',
                        w.processed_quantity || '0',
                        `Rs. ${parseFloat(w.estimated_loss || 0).toFixed(2)}`,
                        new Date(w.date).toLocaleDateString('en-IN'),
                        new Date(w.date).toLocaleTimeString('en-IN')
                    ];
                })
            };
            if (wastageList.length > 0) {
                await doc.table(wasteArray, { width: 500 });
            } else {
                doc.text("No wastage recorded.");
            }

            doc.end();

        } else if (format === 'excel') {
            const workbook = new exceljs.Workbook();
            const sheet = workbook.addWorksheet('Sales Report');
            
            sheet.addRow([docTitle]);
            sheet.addRow([`Report Type: ${(type || 'daily').toUpperCase()}`]);
            sheet.addRow([`Period: ${periodStr}`]);
            sheet.addRow([]);

            sheet.addRow(['--- SUMMARY ---']);
            sheet.addRow(['Total Sales:', `Rs. ${totalSales.toFixed(2)}`]);
            sheet.addRow(['Total Wastage:', `Rs. ${totalWaste.toFixed(2)}`]);
            sheet.addRow(['Net Profit:', `Rs. ${netProfit.toFixed(2)}`]);
            sheet.addRow([]);

            sheet.addRow(['--- TRANSACTIONS ---']);
            sheet.addRow(['Bill Number', 'Customer Name', 'Date & Time', 'Total Amount']);
            if (transactions.length === 0) {
                sheet.addRow(['No transactions found']);
            } else {
                transactions.forEach(t => {
                    sheet.addRow([
                        t.Bill_ID,
                        t.Customer_Name || 'Walk-in',
                        new Date(t.Date).toLocaleString('en-IN'),
                        `Rs. ${parseFloat(t.Total_Amount).toFixed(2)}`
                    ]);
                });
            }
            sheet.addRow([]);

            sheet.addRow(['--- WASTAGE ENTRIES ---']);
            sheet.addRow(['Product Name', 'Quantity', 'Expense Amount', 'Date', 'Time']);
            if (wastageList.length === 0) {
                sheet.addRow(['No wastage recorded']);
            } else {
                wastageList.forEach(w => {
                    sheet.addRow([
                        w.product_name || 'Unknown',
                        w.processed_quantity || '0',
                        `Rs. ${parseFloat(w.estimated_loss || 0).toFixed(2)}`,
                        new Date(w.date).toLocaleDateString('en-IN'),
                        new Date(w.date).toLocaleTimeString('en-IN')
                    ]);
                });
            }

            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
            await workbook.xlsx.write(res);
            res.end();

        } else {
            // Default CSV
            let csv = `"${docTitle}"\n\n`;
            csv += `Report Type:,${(type || 'daily').toUpperCase()}\n`;
            csv += `Period:,${periodStr}\n\n`;
            
            csv += `--- SUMMARY ---\n`;
            csv += `Total Sales:,Rs. ${totalSales.toFixed(2)}\n`;
            csv += `Total Wastage:,Rs. ${totalWaste.toFixed(2)}\n`;
            csv += `Net Profit:,Rs. ${netProfit.toFixed(2)}\n\n`;

            csv += `--- TRANSACTIONS ---\n`;
            csv += `Bill Number,Customer Name,Date & Time,Total Amount\n`;
            if (transactions.length === 0) {
                csv += `No transactions found\n`;
            } else {
                transactions.forEach(t => {
                    const dt = new Date(t.Date).toLocaleString('en-IN').replace(/,/g, '');
                    csv += `"${t.Bill_ID}","${t.Customer_Name || 'Walk-in'}","${dt}","Rs. ${parseFloat(t.Total_Amount).toFixed(2)}"\n`;
                });
            }

            csv += `\n--- WASTAGE ENTRIES ---\n`;
            csv += `Product Name,Quantity,Expense Amount,Date,Time\n`;
            if (wastageList.length === 0) {
                csv += `No wastage recorded\n`;
            } else {
                 wastageList.forEach(w => {
                     csv += `"${w.product_name || 'Unknown'}","${w.processed_quantity || '0'}","Rs. ${parseFloat(w.estimated_loss || 0).toFixed(2)}","${new Date(w.date).toLocaleDateString('en-IN')}","${new Date(w.date).toLocaleTimeString('en-IN')}"\n`;
                 });
            }

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
            res.status(200).send(csv);
        }

    } catch (err) {
        console.error(err);
        res.status(500).send('Error generating report');
    }
});

// ── 12. PRODUCT STOCK REPORT ──────────────────
app.get('/stock-report', verifyToken, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT Product_ID, Product_Name, Price AS Price_Per_Kg, Stock_Quantity, Low_Stock_Threshold FROM Products ORDER BY Stock_Quantity ASC');
        res.json(rows);
    } catch (err) {
        try {
            const [rows] = await pool.query('SELECT Product_ID, Product_Name, Price AS Price_Per_Kg, Stock_Quantity FROM Products ORDER BY Stock_Quantity ASC');
            res.json(rows);
        } catch(e) { res.status(500).send('Error'); }
    }
});

// ── 13. DELETE PRODUCT ────────────────────────
app.delete('/delete-product/:id', verifyToken, verifyRole(['admin']), async (req, res) => {
    const { id } = req.params;
    try {
        // Explicitly set related product_id in transactions to NULL as fallback if FK update wasn't applied
        try { await pool.query('UPDATE transactions SET Product_ID = NULL WHERE Product_ID = ?', [id]); } catch(e) {}
        try { await pool.query('UPDATE wastage SET Product_ID = NULL WHERE Product_ID = ?', [id]); } catch(e) {}
        try { await pool.query('UPDATE Wastage SET Product_ID = NULL WHERE Product_ID = ?', [id]); } catch(e) {}

        const [result] = await pool.query('DELETE FROM Products WHERE Product_ID = ?', [id]);
        if (result.affectedRows > 0) res.json({ success: true, message: 'Product deleted successfully' });
        else res.status(404).json({ success: false, message: 'Product not found' });
    } catch (err) {
        console.error('Delete Product Error:', err);
        res.status(500).json({ success: false, message: 'Error deleting product' });
    }
});

// ── 14. UPDATE PRODUCT ────────────────────────
app.put('/update-product/:id', verifyToken, verifyRole(['admin']), async (req, res) => {
    const { id } = req.params;
    const { Price, AddStock } = req.body;
    try {
        // Fetch current stock before updating
        const [current] = await pool.query('SELECT Stock_Quantity FROM Products WHERE Product_ID = ?', [id]);
        if (current.length === 0) return res.status(404).json({ success: false, message: 'Product not found' });
        
        const existingStock = parseFloat(current[0].Stock_Quantity) || 0;
        const addedStock = parseFloat(AddStock) || 0;
        
        // Validate: no negative stock additions
        if (addedStock < 0) return res.status(400).json({ success: false, message: 'Stock value cannot be negative' });
        
        // Price is overwritten, Stock is incremental (additive)
        if (addedStock > 0) {
            await pool.query('UPDATE Products SET Price = ?, Stock_Quantity = Stock_Quantity + ? WHERE Product_ID = ?', [Price, addedStock, id]);
        } else {
            // Only update price if no stock is being added
            await pool.query('UPDATE Products SET Price = ? WHERE Product_ID = ?', [Price, id]);
        }
        
        const newTotal = existingStock + addedStock;
        res.json({ 
            success: true, 
            message: addedStock > 0 
                ? `Stock updated successfully (Added ${addedStock}kg, Total: ${newTotal.toFixed(2)}kg)` 
                : 'Price updated successfully',
            addedStock: addedStock,
            newTotal: newTotal
        });
    } catch (err) { 
        console.error('Update Product Error:', err);
        res.status(500).json({ success: false, message: 'Error updating product' }); 
    }
});

// ══════════════════════════════════════════════
//  KHATA (CREDIT LEDGER) ROUTES
// ══════════════════════════════════════════════

// Get all khata accounts
app.get('/khata', verifyToken, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM Khata ORDER BY Amount_Due DESC');
        res.json(rows);
    } catch (err) { res.status(500).send('Error fetching khata'); }
});

// Get single khata with transactions
app.get('/khata/:id', verifyToken, async (req, res) => {
    const { id } = req.params;
    try {
        const [account]  = await pool.query('SELECT * FROM Khata WHERE Khata_ID = ?', [id]);
        const [txns]     = await pool.query('SELECT * FROM Khata_Transactions WHERE Khata_ID = ? ORDER BY Txn_Date DESC', [id]);
        res.json({ account: account[0], transactions: txns });
    } catch (err) { res.status(500).send('Error fetching khata details'); }
});

// Add new khata account manually
app.post('/khata', verifyToken, async (req, res) => {
    const { CustomerName, Phone, CreditLimit } = req.body;
    try {
        const [result] = await pool.query(
            'INSERT INTO Khata (Customer_Name, Phone, Credit_Limit, Amount_Due) VALUES (?, ?, ?, 0)',
            [CustomerName, Phone || '', CreditLimit || 5000]
        );
        res.json({ success: true, id: result.insertId });
    } catch (err) {
        console.error('Khata Create Error:', err);
        res.status(500).json({ success: false, message: 'Error creating khata: ' + err.message });
    }
});

// Record a payment (customer pays off debt)
app.post('/khata/:id/pay', verifyToken, async (req, res) => {
    const { id } = req.params;
    const { Amount, Note } = req.body;
    try {
        await pool.query('UPDATE Khata SET Amount_Due = Amount_Due - ? WHERE Khata_ID = ?', [Amount, id]);
        await pool.query(
            'INSERT INTO Khata_Transactions (Khata_ID, Bill_Amount, Payment_Amount, Note) VALUES (?, 0, ?, ?)',
            [id, Amount, Note || 'Payment received']
        );
        res.json({ success: true, message: 'Payment recorded' });
    } catch (err) { res.status(500).send('Error recording payment'); }
});

// Update credit limit
app.put('/khata/:id/limit', verifyToken, verifyRole(['admin']), async (req, res) => {
    const { id } = req.params;
    const { CreditLimit } = req.body;
    try {
        await pool.query('UPDATE Khata SET Credit_Limit = ? WHERE Khata_ID = ?', [CreditLimit, id]);
        res.json({ success: true });
    } catch (err) { res.status(500).send('Error updating limit'); }
});

// Delete khata account (only if Amount_Due <= 0)
app.delete('/khata/:id', verifyToken, verifyRole(['admin']), async (req, res) => {
    const { id } = req.params;
    try {
        const [rows] = await pool.query('SELECT Amount_Due FROM Khata WHERE Khata_ID = ?', [id]);
        if (rows.length === 0) return res.status(404).json({ success: false, message: 'Account not found' });
        if (parseFloat(rows[0].Amount_Due) > 0) return res.status(400).json({ success: false, message: 'Cannot delete account with pending dues (₹' + rows[0].Amount_Due + ')' });
        
        // Manual cascading delete in case FK wasn't set up perfectly
        await pool.query('DELETE FROM Khata_Transactions WHERE Khata_ID = ?', [id]);
        await pool.query('DELETE FROM Khata WHERE Khata_ID = ?', [id]);
        res.json({ success: true, message: 'Khata account deleted' });
    } catch (err) { res.status(500).send('Error deleting khata'); }
});

// ── SHOP SETTINGS ───────────────────────────
app.get('/settings', verifyToken, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM Shop_Settings LIMIT 1');
        if (rows.length > 0) res.json(rows[0]);
        else res.json({ shop_name: 'POULTRY PRO SHOP', owner_name: '', address: '', phone: '', email: '', gst_number: '', logo_url: '' });
    } catch (err) { res.status(500).json({ message: 'Error fetching settings' }); }
});

app.post('/settings', verifyToken, verifyRole(['admin']), async (req, res) => {
    const { shop_name, owner_name, address, phone, email, gst_number } = req.body;
    if (!shop_name || !phone) return res.status(400).json({ success: false, message: 'Shop Name and Phone are required' });
    try {
        const [existing] = await pool.query('SELECT id FROM Shop_Settings LIMIT 1');
        if (existing.length > 0) {
            await pool.query(
                'UPDATE Shop_Settings SET shop_name=?, owner_name=?, address=?, phone=?, email=?, gst_number=? WHERE id=?',
                [shop_name, owner_name || '', address || '', phone, email || '', gst_number || '', existing[0].id]
            );
        } else {
            await pool.query(
                'INSERT INTO Shop_Settings (shop_name, owner_name, address, phone, email, gst_number) VALUES (?,?,?,?,?,?)',
                [shop_name, owner_name || '', address || '', phone, email || '', gst_number || '']
            );
        }
        res.json({ success: true, message: 'Settings saved successfully!' });
    } catch (err) { res.status(500).json({ success: false, message: 'Error saving settings' }); }
});

// ── START ─────────────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
