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
  try {
    const userId = req.user.id;
    const commentText = req.body.comment_text || '';
    
    // Ensure comment is not empty
    if (!commentText.trim()) {
      return res.status(400).json({ message: 'Comment text cannot be empty.' });
    }

    // Sanitize product_id to be a pure number
    const productId = Number(String(req.body.product_id).replace(/[^\d]/g, ''));

    if (!productId) {
      return res.status(400).json({ message: 'Invalid product_id' });
    }

    const sql = `
      INSERT INTO Comment (user_id, product_id, comment_text, comment_date)
      VALUES (?, ?, ?, NOW())
    `;

    db.query(sql, [userId, productId, commentText], (err, result) => {
      if (err) {
        console.error('Error inserting comment:', err);
        return res.status(500).json({ message: 'Database error' });
      }

      return res.status(201).json({ message: 'Comment posted successfully' });
    });

  } catch (error) {
    console.error('Unexpected error in /comments:', error);
    res.status(500).json({ message: 'Unexpected server error' });
  }
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

// Get cart for logged-in user
app.get('/cart', authenticateToken, (req, res) => {
  const userId = req.user.id;

  const findCartSql = 'SELECT * FROM Cart WHERE user_id = ?';
  db.query(findCartSql, [userId], (err, carts) => {
    if (err) return res.status(500).json({ message: 'Database error' });

    if (carts.length === 0) {
      const createCartSql = 'INSERT INTO Cart (user_id) VALUES (?)';
      db.query(createCartSql, [userId], (err, result) => {
        if (err) return res.status(500).json({ message: 'Database error' });
        return res.json({ cart_id: result.insertId, items: [] });
      });
    } else {
      const cartId = carts[0].cart_id;
      const itemsSql = `
        SELECT CI.cart_item_id, CI.product_id, CI.quantity, L.listing_name, L.price, L.photo
        FROM Cart_Item CI
        JOIN Listing L ON CI.product_id = L.product_id
        WHERE CI.cart_id = ?`;
      db.query(itemsSql, [cartId], (err, items) => {
        if (err) return res.status(500).json({ message: 'Database error' });

        const formattedItems = items.map(item => ({
          ...item,
          photo: item.photo ? `data:image/jpeg;base64,${Buffer.from(item.photo).toString('base64')}` : null,
        }));

        return res.json({ cart_id: cartId, items: formattedItems });
      });
    }
  });
});

// Add item to cart (authenticated)
app.post('/cart/add', authenticateToken, (req, res) => {
  const userId = req.user.id;
  const { product_id, quantity = 1 } = req.body;

  if (!product_id) {
    return res.status(400).json({ message: 'Missing product_id' });
  }

  const qty = parseInt(quantity, 10);
  if (isNaN(qty) || qty <= 0) {
    return res.status(400).json({ message: 'Quantity must be a positive integer' });
  }

  const findCartSql = 'SELECT * FROM Cart WHERE user_id = ?';
  db.query(findCartSql, [userId], (err, carts) => {
    if (err) {
      console.error('Error fetching cart:', err);
      return res.status(500).json({ message: 'Database error fetching cart' });
    }

    function addOrUpdateCartItem(cartId) {
      const findItemSql = 'SELECT * FROM Cart_Item WHERE cart_id = ? AND product_id = ?';
      db.query(findItemSql, [cartId, product_id], (err, items) => {
        if (err) {
          console.error('Error fetching cart item:', err);
          return res.status(500).json({ message: 'Database error fetching cart item' });
        }

        if (items.length > 0) {
          const newQuantity = items[0].quantity + qty;
          const updateSql = 'UPDATE Cart_Item SET quantity = ? WHERE cart_item_id = ?';
          db.query(updateSql, [newQuantity, items[0].cart_item_id], (err) => {
            if (err) {
              console.error('Error updating cart item:', err);
              return res.status(500).json({ message: 'Database error updating cart item' });
            }
            return res.json({ message: 'Cart updated' });
          });
        } else {
          const insertSql = 'INSERT INTO Cart_Item (cart_id, product_id, quantity) VALUES (?, ?, ?)';
          db.query(insertSql, [cartId, product_id, qty], (err) => {
            if (err) {
              console.error('Error inserting cart item:', err);
              return res.status(500).json({ message: 'Database error inserting cart item' });
            }
            return res.status(201).json({ message: 'Item added to cart' });
          });
        }
      });
    }

    if (carts.length === 0) {
      const createCartSql = 'INSERT INTO Cart (user_id) VALUES (?)';
      db.query(createCartSql, [userId], (err, result) => {
        if (err) {
          console.error('Error creating cart:', err);
          return res.status(500).json({ message: 'Database error creating cart' });
        }
        addOrUpdateCartItem(result.insertId);
      });
    } else {
      addOrUpdateCartItem(carts[0].cart_id);
    }
  });
});

// Remove item from cart (authenticated)
app.delete('/cart/remove/:cartItemId', authenticateToken, (req, res) => {
  const userId = req.user.id;
  const cartItemId = req.params.cartItemId;

  // First, verify that the cart item belongs to the user's cart
  const checkCartItemSql = `
    SELECT CI.cart_item_id
    FROM Cart_Item CI
    JOIN Cart C ON CI.cart_id = C.cart_id
    WHERE CI.cart_item_id = ? AND C.user_id = ?
  `;

  db.query(checkCartItemSql, [cartItemId, userId], (err, results) => {
    if (err) {
      console.error('Error checking cart item ownership:', err);
      return res.status(500).json({ message: 'Database error' });
    }

    if (results.length === 0) {
      return res.status(404).json({ message: 'Cart item not found or does not belong to user' });
    }

    // If ownership confirmed, delete the item
    const deleteSql = 'DELETE FROM Cart_Item WHERE cart_item_id = ?';
    db.query(deleteSql, [cartItemId], (err) => {
      if (err) {
        console.error('Error deleting cart item:', err);
        return res.status(500).json({ message: 'Database error deleting cart item' });
      }
      return res.json({ message: 'Item removed from cart' });
    });
  });
});

// Example shipping cost fixed or calculated
const SHIPPING_COST = 5;

app.post('/order/checkout', authenticateToken, (req, res) => {
  const userId = req.user.id;
  const { address, payment_method } = req.body;

  if (!address || !payment_method) {
    return res.status(400).json({ message: 'Address and payment method are required' });
  }

  // Fetch cart items for the user
  const getCartSql = `
    SELECT CI.quantity, L.price
    FROM Cart_Item CI
    JOIN Cart C ON CI.cart_id = C.cart_id
    JOIN Listing L ON CI.product_id = L.product_id
    WHERE C.user_id = ?
  `;

  db.query(getCartSql, [userId], (err, items) => {
    if (err) {
      console.error('Error fetching cart items:', err);
      return res.status(500).json({ message: 'Database error fetching cart items' });
    }

    if (items.length === 0) {
      return res.status(400).json({ message: 'Cart is empty' });
    }

    // Calculate total order amount (items + shipping)
    let itemsTotal = 0;
    items.forEach(item => {
      itemsTotal += item.price * item.quantity;
    });

    const orderAmount = itemsTotal + SHIPPING_COST;

    // Insert new order
    const insertOrderSql = `
      INSERT INTO \`Order\` (user_id, address, order_amount, status)
      VALUES (?, ?, ?, 'processing')
    `;

    db.query(insertOrderSql, [userId, address, orderAmount], (err, result) => {
      if (err) {
        console.error('Error creating order:', err);
        return res.status(500).json({ message: 'Database error creating order' });
      }

      const orderId = result.insertId;

      // Optional: clear the user's cart items after order
      const clearCartSql = `
        DELETE CI FROM Cart_Item CI
        JOIN Cart C ON CI.cart_id = C.cart_id
        WHERE C.user_id = ?
      `;
      db.query(clearCartSql, [userId], (err) => {
        if (err) console.error('Error clearing cart after order:', err);
      });

      return res.json({
        message: 'Order placed successfully',
        order_id: orderId,
        order_amount: orderAmount,
        shipping_cost: SHIPPING_COST,
        payment_method
      });
    });
  });
});


app.put('/listing/:product_id', authenticateToken, async (req, res) => {
  try {
    const { product_id } = req.params;
    const { listing_name, description, condition, price } = req.body;
    const userId = req.user.id; // from authenticateToken

    // Update listing that belongs to this user
    const [result] = await db
      .promise()
      .query(
        `UPDATE Listing
         SET listing_name = ?, description = ?, \`condition\` = ?, price = ?
         WHERE product_id = ? AND user_id = ?`,
        [listing_name, description, condition, price, product_id, userId]
      );

    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ error: 'Listing not found or you are not the owner' });
    }

    res.json({ message: 'Listing updated successfully' });
  } catch (err) {
    console.error('Error updating listing:', err);
    res.status(500).json({ error: 'Server error' });
  }
});
app.delete('/listing/:product_id', authenticateToken, async (req, res) => {
  try {
    const { product_id } = req.params;
    const userId = req.user.id; // from authenticateToken

    const [result] = await db
      .promise()
      .query(
        `DELETE FROM Listing
         WHERE product_id = ? AND user_id = ?`,
        [product_id, userId]
      );

    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ error: 'Listing not found or you are not the owner' });
    }

    res.json({ message: 'Listing deleted successfully' });
  } catch (err) {
    console.error('Error deleting listing:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/listings', authenticateToken, upload.single('photo'), (req, res) => {
  const { listing_name, description, condition, price } = req.body;
  const user_id = req.user.id; // comes from JWT after authentication
  const photo = req.file ? req.file.buffer : null;

  const sql = `
    INSERT INTO Listing (user_id, listing_name, description, \`condition\`, price, photo)
    VALUES (?, ?, ?, ?, ?, ?)
  `;

  db.query(sql, [user_id, listing_name, description, condition, price, photo], (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ message: 'Error creating listing' });
    }
    res.status(201).json({ message: 'Listing created successfully', listingId: results.insertId });
  });
});

const PORT = process.env.PORT || 4200;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
