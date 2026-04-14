# Poultry Billing App

A comprehensive billing and inventory management system for poultry shops.

## Features
- **Sales Management**: Generate bills and track transactions.
- **Inventory Tracking**: Monitor stock levels and wastage.
- **Customer Management**: Maintain customer records and loyalty data.
- **Khata System**: Manage credits and dues for regular customers.
- **Reports**: Generate daily and periodic sales reports (PDF/Excel).

## Deployment
This application is designed to be deployed on **Render** (Web Service) and **Railway** (MySQL Database).

### Environment Variables
- `PORT`: Port for the server (default: 5000).
- `MYSQL_HOST`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`: Connection details for your Railway database.

## Tech Stack
- **Backend**: Node.js, Express
- **Database**: MySQL (Railway)
- **PDF/Excel**: PDFKit, ExcelJS
