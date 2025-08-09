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
app.use(express.urlencoded({ extended: true })); // For form data (multer, etc.)

const db = mysql.createConnection({
  host: 'localhost',
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_DATABASE,
  port: process.env.DB_PORT,
});

db.connect(err => {
  if (err) {
    console.error('MySQL connection error:', err);
    process.exit(1);
  }
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
    const sql = `
      INSERT INTO User 
      (username, password, email, name, surname, age, bio, profile_picture, role, is_admin) 
      VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, 'user', 0)
    `;

    db.query(sql, [username, hashedPassword, email, name, surname], (err, result) => {
      if (err) {
        if (err.code === 'ER_DUP_ENTRY') {
          return res.status(409).json({ message: 'Username or email already exists' });
        }
        console.error('Register error:', err);
        return res.status(500).json({ message: 'Database error' });
      }
      return res.status(201).json({ message: 'User registered' });
    });
  } catch (error) {
    console.error('Register server error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Login endpoint
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

    if (results.length === 0) {
      console.log(`User with username "${username}" not found`);
      return res.status(401).json({ message: 'Invalid username or password' });
    }

    const user = results[0];
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

        const token = jwt.sign(
          { id: user.user_id, username: user.username },
          JWT_SECRET,
          { expiresIn: '90d' }
        );

        return res.json({ user: safeUser, token });
      })
      .catch(error => {
        console.error('Error comparing passwords:', error);
        return res.status(500).json({ message: 'Server error' });
      });
  });
});

// Get user profile by ID
app.get('/profile/:id', (req, res) => {
  const userId = req.params.id;
  db.query('SELECT * FROM User WHERE user_id = ?', [userId], (err, results) => {
    if (err) {
      console.error('Error fetching profile:', err);
      return res.status(500).json({ message: 'Database error' });
    }
    if (results.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = results[0];
    delete user.password;
    return res.json(user);
  });
});

// Update profile with optional profile_picture upload
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
    // Return updated user info
    db.query('SELECT * FROM User WHERE user_id = ?', [userId], (err, rows) => {
      if (err) {
        console.error('Error fetching updated user:', err);
        return res.status(500).json({ message: 'Error fetching updated user', error: err });
      }
      const updatedUser = rows[0];
      delete updatedUser.password;
      return res.json(updatedUser);
    });
  });
});

// Serve profile pictures as images
app.get('/profile-picture/:id', (req, res) => {
  const userId = req.params.id;
  db.query('SELECT profile_picture FROM User WHERE user_id = ?', [userId], (err, results) => {
    if (err) {
      console.error('Error fetching profile picture:', err);
      return res.status(500).send('Server error');
    }
    if (results.length === 0 || !results[0].profile_picture) {
      return res.status(404).send('No image');
    }
    const img = results[0].profile_picture;
    res.writeHead(200, {
      'Content-Type': 'image/jpeg',
      'Content-Length': img.length
    });
    return res.end(img);
  });
});

// Get all listings with photo as base64 data URL
app.get('/listings', (req, res) => {
  const sql = 'SELECT * FROM Listing';

  db.query(sql, (err, results) => {
    if (err) {
      console.error('Error fetching listings:', err);
      return res.status(500).json({ message: 'Database error' });
    }

    const listingsWithPhotos = results.map(listing => {
      let photo = null;
      if (listing.photo) {
        photo = `data:image/jpeg;base64,${Buffer.from(listing.photo).toString('base64')}`;
      }
      return { ...listing, photo };
    });

    return res.json({ listings: listingsWithPhotos });
  });
});

// Add a listing to wishlist
app.post('/wishlist', (req, res) => {
  const { user_id, product_id } = req.body;
  if (!user_id || !product_id) {
    return res.status(400).json({ message: 'Missing user_id or product_id' });
  }

  const sql = 'INSERT INTO Wishlist (user_id, product_id) VALUES (?, ?)';
  db.query(sql, [user_id, product_id], (err, result) => {
    if (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ message: 'Already in wishlist' });
      }
      console.error('Error adding to wishlist:', err);
      return res.status(500).json({ message: 'Database error' });
    }
    return res.status(201).json({ message: 'Added to wishlist' });
  });
});

// Remove a listing from wishlist
app.delete('/wishlist', (req, res) => {
  const { user_id, product_id } = req.body;
  if (!user_id || !product_id) {
    return res.status(400).json({ message: 'Missing user_id or product_id' });
  }

  const sql = 'DELETE FROM Wishlist WHERE user_id = ? AND product_id = ?';
  db.query(sql, [user_id, product_id], (err, result) => {
    if (err) {
      console.error('Error removing from wishlist:', err);
      return res.status(500).json({ message: 'Database error' });
    }
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Not found in wishlist' });
    }
    return res.json({ message: 'Removed from wishlist' });
  });
});

// Get wishlist for user
app.get('/wishlist/:user_id', (req, res) => {
  const userId = req.params.user_id;
  const sql = `
    SELECT L.* FROM Listing L
    JOIN Wishlist W ON L.product_id = W.product_id
    WHERE W.user_id = ?`;

  db.query(sql, [userId], (err, results) => {
    if (err) {
      console.error('Error fetching wishlist:', err);
      return res.status(500).json({ message: 'Database error' });
    }

    const listingsWithPhotos = results.map(listing => {
      let photo = null;
      if (listing.photo) {
        photo = `data:image/jpeg;base64,${Buffer.from(listing.photo).toString('base64')}`;
      }
      return { ...listing, photo };
    });

    return res.json({ wishlist: listingsWithPhotos });
  });
});

// Get a single listing with seller info
app.get('/listing/:product_id', (req, res) => {
  const productId = req.params.product_id;
  const sql = `
    SELECT L.*, U.username, U.user_id as seller_id
    FROM Listing L
    JOIN User U ON L.user_id = U.user_id
    WHERE L.product_id = ?
  `;

  db.query(sql, [productId], (err, results) => {
    if (err) {
      console.error('Error fetching listing:', err);
      return res.status(500).json({ message: 'Database error' });
    }
    if (results.length === 0) {
      return res.status(404).json({ message: 'Listing not found' });
    }
    const listing = results[0];
    if (listing.photo) {
      listing.photo = `data:image/jpeg;base64,${Buffer.from(listing.photo).toString('base64')}`;
    } else {
      listing.photo = null;
    }
    return res.json({ listing });
  });
});

// Get comments for a listing
app.get('/comments/:product_id', (req, res) => {
  const productId = req.params.product_id;
  const sql = `
    SELECT C.comment_id, C.comment_text, C.comment_date, U.username, U.user_id
    FROM Comment C
    JOIN User U ON C.user_id = U.user_id
    WHERE C.product_id = ?
    ORDER BY C.comment_date DESC
  `;
  db.query(sql, [productId], (err, results) => {
    if (err) {
      console.error('Error fetching comments:', err);
      return res.status(500).json({ message: 'Database error' });
    }
    return res.json({ comments: results });
  });
});

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  console.log('Authorization header:', authHeader);

  if (!authHeader) {
    console.log('No Authorization header');
    return res.status(401).json({ message: 'Missing Authorization header' });
  }

  const token = authHeader.split(' ')[1];
  console.log('Token extracted:', token);

  if (!token) {
    console.log('Token missing after "Bearer"');
    return res.status(401).json({ message: 'Missing token' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      console.log('Token verification failed:', err.message);
      return res.status(403).json({ message: 'Invalid token' });
    }
    console.log('Token verified successfully:', user);
    req.user = user;
    next();
  });
}

// Post a comment to a listing (authenticated)
app.post('/comments', authenticateToken, (req, res) => {
  const { product_id, comment_text } = req.body;
  if (!product_id || !comment_text) {
    return res.status(400).json({ message: 'Missing product_id or comment_text' });
  }
  const userId = req.user.id;

  const sql = 'INSERT INTO Comment (user_id, product_id, comment_text, comment_date) VALUES (?, ?, ?, NOW())';
  db.query(sql, [userId, product_id, comment_text], (err, result) => {
    if (err) {
      console.error('Error inserting comment:', err);
      return res.status(500).json({ message: 'Database error' });
    }
    return res.status(201).json({ message: 'Comment added', comment_id: result.insertId });
  });
});

// Delete a comment (authenticated)
app.delete('/comments/:comment_id', authenticateToken, (req, res) => {
  const commentId = req.params.comment_id;
  const userId = req.user.id;

  // First, check if the comment exists and who owns it
  const selectSql = 'SELECT user_id FROM Comment WHERE comment_id = ?';
  db.query(selectSql, [commentId], (err, results) => {
    if (err) {
      console.error('Error fetching comment:', err);
      return res.status(500).json({ message: 'Database error' });
    }
    if (results.length === 0) {
      return res.status(404).json({ message: 'Comment not found' });
    }

    const commentOwnerId = results[0].user_id;

    // Allow delete if user owns comment or is admin
    // Assume you have is_admin flag on req.user; if not, adjust accordingly
    if (commentOwnerId !== userId && !req.user.is_admin) {
      return res.status(403).json({ message: 'Not authorized to delete this comment' });
    }

    // Delete comment
    const deleteSql = 'DELETE FROM Comment WHERE comment_id = ?';
    db.query(deleteSql, [commentId], (deleteErr, deleteResult) => {
      if (deleteErr) {
        console.error('Error deleting comment:', deleteErr);
        return res.status(500).json({ message: 'Database error deleting comment' });
      }
      res.json({ message: 'Comment deleted successfully' });
    });
  });
});

app.post('/report', authenticateToken, (req, res) => {
  const reporterUserId = req.user.id; // from token
  const {
    product_id,
    comment_id = null,
    reported_user_id,
    report_reason = null,
  } = req.body;

  if (!reported_user_id || !product_id) {
    return res.status(400).json({ message: 'Missing required fields.' });
  }

  const insertSql = `
    INSERT INTO Report 
    (user_id, reported_user_id, product_id, comment_id, report_reason, report_date)
    VALUES (?, ?, ?, ?, ?, NOW())
  `;

  db.query(
    insertSql,
    [reporterUserId, reported_user_id, product_id, comment_id, report_reason],
    (err, result) => {
      if (err) {
        console.error('Error inserting report:', err);
        return res.status(500).json({ message: 'Database error.' });
      }
      res.json({ message: 'Report submitted successfully' });
    }
  );
});

// Get listings created by a specific user
app.get('/listings/user/:user_id', (req, res) => {
  const userId = req.params.user_id;
  const sql = 'SELECT * FROM Listing WHERE user_id = ?';

  db.query(sql, [userId], (err, results) => {
    if (err) {
      console.error('Error fetching user listings:', err);
      return res.status(500).json({ message: 'Database error' });
    }

    const listingsWithPhotos = results.map(listing => {
      let photo = null;
      if (listing.photo) {
        photo = `data:image/jpeg;base64,${Buffer.from(listing.photo).toString('base64')}`;
      }
      return { ...listing, photo };
    });

    return res.json({ listings: listingsWithPhotos });
  });
});


const PORT = process.env.PORT || 4200;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
