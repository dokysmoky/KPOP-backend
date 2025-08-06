const express = require('express'); 
const mysql = require('mysql2');
const cors = require('cors');
const bcrypt = require('bcrypt');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
require('dotenv').config();
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'your_secret_key_here'; 

const app = express();
app.use(cors());
app.use(express.json());

const db = mysql.createConnection({
  host: 'localhost',
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_DATABASE,
  port: process.env.DB_PORT,
});

db.connect(err => {
  if (err) throw err;
  console.log('Connected to MySQL');
});

// Register endpoint
app.post('/register', async (req, res) => {
  try {
    const { username, password, email, name, surname } = req.body;
    if (!username || !password || !email || !name || !surname) {
      return res.status(400).json({ message: 'Missing fields' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const sql = `INSERT INTO User 
      (username, password, email, name, surname, age, bio, profile_picture, role, is_admin) 
      VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, 'user', 0)`;

    db.query(sql, [username, hashedPassword, email, name, surname], (err, result) => {
      if (err) {
        if (err.code === 'ER_DUP_ENTRY') {
          return res.status(409).json({ message: 'Username or email already exists' });
        }
        console.error(err);
        return res.status(500).json({ message: 'Database error' });
      }
      res.status(201).json({ message: 'User registered' });
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Login endpoint with profile_picture excluded from response
app.post('/login', (req, res) => {
  console.log('Login request received:', req.body);
  const { username, password } = req.body;

  if (!username || !password) {
    console.log('Missing username or password');
    return res.status(400).json({ message: 'Missing username or password' });
  }

  const sql = 'SELECT * FROM User WHERE username = ?';

  db.query(sql, [username], (err, results) => {
    if (err) {
      console.error('Database error during login:', err);
      return res.status(500).json({ message: 'Database error' });
    }

    console.log('DB query results:', results);

    if (results.length === 0) {
      console.log(`User with username "${username}" not found`);
      return res.status(401).json({ message: 'Invalid username or password' });
    }

    const user = results[0];
    console.log('User record found:', { id: user.user_id, username: user.username, passwordHash: user.password });
bcrypt.compare(password, user.password)
  .then(match => {
    if (!match) {
      return res.status(401).json({ message: 'Invalid username or password' });
    }

    const safeUser = {
      id: user.user_id,
      username: user.username,
      name: user.name,
      surname: user.surname,
      email: user.email,
      age: user.age,
      bio: user.bio,
      role: user.role,
      is_admin: user.is_admin
    };

    // Generate JWT token
    const token = jwt.sign({ id: user.user_id, username: user.username }, JWT_SECRET, { expiresIn: '1d' });

    return res.json({ user: safeUser, token });
  })
  .catch(error => {
    console.error('Error comparing passwords:', error);
    return res.status(500).json({ message: 'Server error' });
  });
  });
});

// Get user profile by ID (optional)
app.get('/profile/:id', (req, res) => {
  const userId = req.params.id;
  db.query('SELECT * FROM User WHERE user_id = ?', [userId], (err, results) => {
    if (err) return res.status(500).json({ message: 'Database error' });
    if (results.length === 0) return res.status(404).json({ message: 'User not found' });

    const user = results[0];
    delete user.password;
    res.json(user);
  });
});

// Update profile endpoint (with optional profile picture upload)
app.put('/profile/:id', upload.single('profile_picture'), (req, res) => {
  const userId = req.params.id;
  let { age, bio } = req.body;

  age = age ? Number(age) : null;
  bio = bio || null;

  let sql;
  let params;

  if (req.file) {
    sql = 'UPDATE User SET age = ?, bio = ?, profile_picture = ? WHERE user_id = ?';
    params = [age, bio, req.file.buffer, userId];
  } else {
    sql = 'UPDATE User SET age = ?, bio = ? WHERE user_id = ?';
    params = [age, bio, userId];
  }

  db.query(sql, params, (error, results) => {
    if (error) {
      console.error('Error updating profile:', error);
      return res.status(500).json({ message: 'Error updating profile', error });
    } 
    // Return updated user info to frontend
    db.query('SELECT * FROM User WHERE user_id = ?', [userId], (err, rows) => {
      if (err) {
        console.error('Error fetching updated user:', err);
        return res.status(500).json({ message: 'Error fetching updated user', error: err });
      }
      const updatedUser = rows[0];
      delete updatedUser.password;
      // Remove profile_picture or handle separately if needed
      res.json(updatedUser);
    });
  });
});

// New endpoint to serve profile pictures as images
app.get('/profile-picture/:id', (req, res) => {
  const userId = req.params.id;
  db.query('SELECT profile_picture FROM User WHERE user_id = ?', [userId], (err, results) => {
    if (err || results.length === 0 || !results[0].profile_picture) {
      return res.status(404).send('No image');
    }
    const img = results[0].profile_picture;
    res.writeHead(200, {
      'Content-Type': 'image/jpeg',
      'Content-Length': img.length
    });
    res.end(img);
  });
});
app.get('/listings', (req, res) => {
  const sql = 'SELECT * FROM Listing';

  db.query(sql, (err, results) => {
    if (err) {
      console.error('Error fetching listings:', err);
      return res.status(500).json({ message: 'Database error' });
    }

    // Convert photo buffer to base64 string
    const listingsWithPhotos = results.map(listing => {
      let photo = null;
      if (listing.photo) {
        photo = `data:image/jpeg;base64,${Buffer.from(listing.photo).toString('base64')}`;
      }
      return { ...listing, photo };
    });

    res.json({ listings: listingsWithPhotos });
  });
});

const PORT = process.env.PORT || 4200;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
