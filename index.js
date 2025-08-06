const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bcrypt = require('bcrypt');  // for password hashing
require('dotenv').config();
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

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

app.put('/profile/:id', upload.single('profile_picture'), (req, res) => {
  const { age, bio } = req.body;
  const profile_picture = req.file ? req.file.buffer : null;
  const userId = req.params.id;

 console.log("Received age:", age);
  console.log("Received bio:", bio);
  console.log("Received file:", req.file);

  const sqlUpdateUser = `UPDATE User SET age = ?, bio = ?, profile_picture = ? WHERE user_id = ?`;
  db.query(sqlUpdateUser, [age, bio, profile_picture, userId], (err, result) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ message: 'Error updating user' });
    }

    // Now fetch the updated user
    const sqlGetUser = `SELECT user_id, username, email, name, surname, age, bio, profile_picture, role, is_admin FROM User WHERE user_id = ?`;
    db.query(sqlGetUser, [userId], (err, results) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ message: 'Database error' });
      }
      if (results.length === 0) {
        return res.status(404).json({ message: 'User not found after update' });
      }
      res.json({ message: 'Profile updated successfully', updatedUser: results[0] });
    });
  });
});

app.post('/listings', upload.single('photo'), (req, res) => {
  const { user_id, listing_name, description, condition, price } = req.body;
  const photo = req.file ? req.file.buffer : null;

  const sql = `INSERT INTO Listing (user_id, listing_name, description, \`condition\`, price, photo)
             VALUES (?, ?, ?, ?, ?, ?)`;

db.query(sql, [user_id, listing_name, description, condition, price, photo], (err, results) => {
  if (err) {
    console.error(err);
    return res.status(500).json({ message: 'Error creating listing' });
  }
  res.status(201).json({ message: 'Listing created successfully', listingId: results.insertId });
});});



const port = 4200;
app.get('/', (req, res) => {
  res.send('Hello, your backend is alive!');
});

app.listen(port,'0.0.0.0', () => {
  console.log(`Server running at: ${port}`);
});
