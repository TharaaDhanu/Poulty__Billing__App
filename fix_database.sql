-- ══════════════════════════════════════════════════════════
--  Poultry Pro — CREATE ALL TABLES (clean slate)
-- ══════════════════════════════════════════════════════════

USE poultrybillingdb;

CREATE TABLE Products (
    Product_ID         INT AUTO_INCREMENT PRIMARY KEY,
    Product_Name       VARCHAR(255) NOT NULL,
    Price              DECIMAL(10,2) NOT NULL,
    Stock_Quantity     DECIMAL(10,2) NOT NULL DEFAULT 0,
    Low_Stock_Threshold DECIMAL(10,2) DEFAULT 5
) ENGINE=InnoDB;

CREATE TABLE bills (
    Bill_ID        INT AUTO_INCREMENT PRIMARY KEY,
    Customer_Name  VARCHAR(255),
    Total_Amount   DECIMAL(10,2) NOT NULL DEFAULT 0,
    Date           TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE transactions (
    Transaction_ID   INT AUTO_INCREMENT PRIMARY KEY,
    Customer_Name    VARCHAR(100),
    Product_ID       INT DEFAULT NULL,
    Quantity         DECIMAL(10,2) NOT NULL,
    Total_Price      DECIMAL(10,2) NOT NULL,
    Transaction_Date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (Product_ID) REFERENCES Products(Product_ID) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE wastage (
    Wastage_ID   INT AUTO_INCREMENT PRIMARY KEY,
    Product_ID   INT DEFAULT NULL,
    Quantity     DECIMAL(10,2) DEFAULT 0,
    Reason       VARCHAR(255) DEFAULT '',
    Loss_Amount  DECIMAL(10,2) DEFAULT 0,
    Date         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (Product_ID) REFERENCES Products(Product_ID) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE Customers (
    Customer_ID    INT AUTO_INCREMENT PRIMARY KEY,
    Customer_Name  VARCHAR(255) NOT NULL,
    Phone          VARCHAR(20) DEFAULT '',
    Address        VARCHAR(255) DEFAULT '',
    Created_At     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE Users (
    ID        INT AUTO_INCREMENT PRIMARY KEY,
    Username  VARCHAR(255) UNIQUE NOT NULL,
    Password  VARCHAR(255) NOT NULL,
    Role      VARCHAR(50) DEFAULT 'admin'
) ENGINE=InnoDB;

CREATE TABLE Khata (
    Khata_ID       INT AUTO_INCREMENT PRIMARY KEY,
    Customer_Name  VARCHAR(255) NOT NULL,
    Phone          VARCHAR(20) DEFAULT '',
    Credit_Limit   DECIMAL(10,2) DEFAULT 5000.00,
    Amount_Due     DECIMAL(10,2) DEFAULT 0.00,
    Last_Updated   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE Khata_Transactions (
    Txn_ID          INT AUTO_INCREMENT PRIMARY KEY,
    Khata_ID        INT NOT NULL,
    Bill_Amount     DECIMAL(10,2) DEFAULT 0.00,
    Payment_Amount  DECIMAL(10,2) DEFAULT 0.00,
    Note            VARCHAR(255) DEFAULT '',
    Txn_Date        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (Khata_ID) REFERENCES Khata(Khata_ID) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE Shop_Settings (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    shop_name   VARCHAR(255) DEFAULT 'POULTRY PRO SHOP',
    owner_name  VARCHAR(255) DEFAULT '',
    address     VARCHAR(500) DEFAULT '',
    phone       VARCHAR(50) DEFAULT '',
    email       VARCHAR(255) DEFAULT '',
    gst_number  VARCHAR(50) DEFAULT '',
    logo_url    VARCHAR(500) DEFAULT ''
) ENGINE=InnoDB;

SELECT 'ALL 9 TABLES CREATED SUCCESSFULLY!' AS Result;
