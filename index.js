const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bcrypt = require('bcrypt');  // for password hashing
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

// MySQL connection setup here...
const db = mysql.createConnection({
  host: 'localhost',
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_DATABASE,
  port: process.env.DB_PORT,
});

db.connect(err => {
  if (err) throw err;
  console.log('Connected to database');
});

// Register endpoint
app.get('/register', (req, res) => {
  res.send("Register GET works");
});

console.log("Register route is being loaded...");

app.post('/register', async (req, res) => {
  try {
    const { username, password, email, name, surname } = req.body;

    if (!username || !password || !email || !name || !surname) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const sql = `INSERT INTO User 
      (username, password, email, name, surname, age, bio, profile_picture, role, is_admin) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    const defaultAge = null;  // or 0
    const defaultBio = null;  // or empty string ''
    const defaultProfilePic = null; // assuming blob is nullable
    const defaultRole = 'user';  // default role string
    const defaultIsAdmin = 0;    // 0 means false

    db.query(sql, [username, hashedPassword, email, name, surname, defaultAge, defaultBio, defaultProfilePic, defaultRole, defaultIsAdmin], (err, results) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ message: 'Database error' });
      }
      res.status(201).json({ message: 'User registered successfully' });
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: 'Missing username or password' });
  }

  const sql = 'SELECT * FROM User WHERE username = ?';
  db.query(sql, [username], async (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ message: 'Database error' });
    }

    if (results.length === 0) {
      return res.status(401).json({ message: 'Invalid username or password' });
    }

    const user = results[0];
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid username or password' });
    }

    const { password: pw, ...userWithoutPassword } = user;
    res.json({ message: 'Login successful', user: userWithoutPassword });
  });
});

const port = 4200;
app.listen(port, () => {
  console.log(`Server running at: ${port}`);
});
