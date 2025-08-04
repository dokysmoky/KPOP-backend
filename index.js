const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

// MySQL database connection
const db = mysql.createConnection({
  host: 'localhost',
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_DATABASE,
});

db.connect(err => {
  if (err) throw err;
  console.log('Connected to database');
});

// Test route
app.get('/', (req, res) => {
  res.send('Kpop Photocard Backend is running');
});

// Fetch all listings
app.get('/listings', (req, res) => {
  db.query('SELECT * FROM Listing', (err, results) => {
    if (err) return res.status(500).send(err);
    res.json(results);
  });
});

// Start server
const port = 4200;
app.listen(port, () => {
  console.log(`Server running at: ${port}`);
});
