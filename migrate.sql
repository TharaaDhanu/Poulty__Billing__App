-- ══════════════════════════════════════════════════════════
--  Poultry Pro — Database Migration
--  Run this ONCE in MySQL before starting the new server.js
-- ══════════════════════════════════════════════════════════

USE poultrybillingdb;

-- 1. Add Low Stock Threshold column to Products
ALTER TABLE Products
  ADD COLUMN IF NOT EXISTS Low_Stock_Threshold DECIMAL(10,2) DEFAULT 5;

-- 2. Khata (Credit Ledger) main accounts table
CREATE TABLE IF NOT EXISTS Khata (
  Khata_ID       INT AUTO_INCREMENT PRIMARY KEY,
  Customer_Name  VARCHAR(255) NOT NULL,
  Phone          VARCHAR(20)  DEFAULT '',
  Credit_Limit   DECIMAL(10,2) DEFAULT 5000.00,
  Amount_Due     DECIMAL(10,2) DEFAULT 0.00,
  Last_Updated   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 3. Khata transaction log (every bill charge + every payment)
CREATE TABLE IF NOT EXISTS Khata_Transactions (
  Txn_ID         INT AUTO_INCREMENT PRIMARY KEY,
  Khata_ID       INT NOT NULL,
  Bill_Amount    DECIMAL(10,2) DEFAULT 0.00,
  Payment_Amount DECIMAL(10,2) DEFAULT 0.00,
  Note           VARCHAR(255)  DEFAULT '',
  Txn_Date       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (Khata_ID) REFERENCES Khata(Khata_ID) ON DELETE CASCADE
);

-- ══════════════════════════════════════════════════════════
--  Done! You can now restart your server: node server.js
-- ══════════════════════════════════════════════════════════
