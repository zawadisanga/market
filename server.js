// This should be at the VERY TOP of server.js
require('dotenv').config();

// Then check if JWT_SECRET exists
if (!process.env.JWT_SECRET) {
    console.error('ERROR: JWT_SECRET is not set in .env file!');
    process.exit(1);
}


const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  transports: ['websocket', 'polling']
});

// Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Rate limiting
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
app.use('/api/', limiter);

// Directories
const dataDir = path.join(__dirname, 'data');
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const DB_PATH = path.join(dataDir, 'database.json');

// ============= DATABASE INIT =============
function initDB() {
  if (!fs.existsSync(DB_PATH)) {
    const initialData = {
      users: [],
      products: [],
      messages: [],
      chats: [],
      reviews: [],
      orders: [],
      transactions: [],
      withdrawals: [],
      subscriptions: [],
      passwordResets: [],
      platformAccount: {
        balance: 0,
        totalEarned: 0,
        totalWithdrawn: 0
      },
      analytics: { pageViews: 0, totalSales: 0, totalUsers: 0, totalCommission: 0 },
      settings: {
        siteName: 'MarketHub Worldwide',
        siteEmail: 'support@markethub.com',
        commissionRate: 20, // 20%
        maintenanceMode: false,
        defaultCurrency: 'USD'
      }
    };
    fs.writeFileSync(DB_PATH, JSON.stringify(initialData, null, 2));
  }
}

function readDB() { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }
function writeDB(data) { fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2)); }
initDB();

// ============= MULTER =============
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${Math.random().toString(36).substring(7)}${path.extname(file.originalname)}`);
  }
});
const upload = multer({ 
  storage, limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    cb(null, allowed.test(path.extname(file.originalname).toLowerCase()) && allowed.test(file.mimetype));
  }
});

// ============= AUTH MIDDLEWARE =============
function authenticateToken(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access token required' });
  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
}

// ============= USER ROUTES =============
app.post('/api/register', async (req, res) => {
  try {
    const { username, email, password, fullName, country, phone, bankCard, bankName } = req.body;
    const db = readDB();
    if (db.users.find(u => u.email === email)) return res.status(400).json({ error: 'Email already registered' });
    if (db.users.find(u => u.username === username)) return res.status(400).json({ error: 'Username taken' });
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = {
      id: uuidv4(),
      username, email, password: hashedPassword, fullName,
      country: country || 'Tanzania', phone: phone || '',
      bankCard: bankCard || '', bankName: bankName || '',
      balance: 0, totalEarned: 0, totalWithdrawn: 0,
      subscriptionActive: false, subscriptionExpiry: null,
      subscriptionType: null, // 'basic' ($50/year) or 'premium' ($500/year)
      createdAt: new Date().toISOString(),
      avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(fullName)}&background=random`,
      role: 'user', verified: false, rating: 0, totalSales: 0
    };
    db.users.push(newUser);
    db.analytics.totalUsers = db.users.length;
    writeDB(db);
    
    const token = jwt.sign({ id: newUser.id, username, email, role: 'user' }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: newUser.id, username, email, fullName, avatar: newUser.avatar, role: 'user', balance: 0 } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const db = readDB();
    const user = db.users.find(u => u.email === email);
    if (!user || !(await bcrypt.compare(password, user.password))) 
      return res.status(401).json({ error: 'Invalid credentials' });
    
    const token = jwt.sign({ id: user.id, username: user.username, email, role: user.role }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user.id, username: user.username, email, fullName: user.fullName, avatar: user.avatar, role: user.role, balance: user.balance, totalEarned: user.totalEarned } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/me', authenticateToken, (req, res) => {
  const db = readDB();
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

// ============= SUBSCRIPTION ROUTES =============
app.post('/api/subscribe', authenticateToken, async (req, res) => {
  try {
    const { type } = req.body; // 'basic' ($50) or 'premium' ($500)
    const db = readDB();
    const userIndex = db.users.findIndex(u => u.id === req.user.id);
    if (userIndex === -1) return res.status(404).json({ error: 'User not found' });
    
    const price = type === 'premium' ? 500 : 50;
    
    // In production, integrate payment gateway here
    // For demo, we'll just activate subscription
    
    const expiryDate = new Date();
    expiryDate.setFullYear(expiryDate.getFullYear() + 1);
    
    db.users[userIndex].subscriptionActive = true;
    db.users[userIndex].subscriptionExpiry = expiryDate.toISOString();
    db.users[userIndex].subscriptionType = type;
    
    db.subscriptions.push({
      id: uuidv4(),
      userId: req.user.id,
      type,
      amount: price,
      paidAt: new Date().toISOString(),
      expiryDate: expiryDate.toISOString()
    });
    
    // Add to platform account
    db.platformAccount.balance += price;
    db.platformAccount.totalEarned += price;
    
    writeDB(db);
    res.json({ success: true, message: `Subscribed to ${type} plan for $${price}/year`, expiry: expiryDate });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============= PRODUCT ROUTES WITH COMMISSION =============
app.post('/api/products', authenticateToken, upload.array('images', 10), async (req, res) => {
  try {
    const { title, description, price, category, condition, currency, location, brand, phoneNumber } = req.body;
    const db = readDB();
    const user = db.users.find(u => u.id === req.user.id);
    
    // Check subscription
    if (!user.subscriptionActive || new Date(user.subscriptionExpiry) < new Date()) {
      return res.status(403).json({ error: 'Active subscription required. Please subscribe to list products.' });
    }
    
    // Check product type limit for basic plan
    const userProducts = db.products.filter(p => p.sellerId === req.user.id);
    if (user.subscriptionType === 'basic') {
      const productTypes = [...new Set(userProducts.map(p => p.category))];
      if (productTypes.length >= 1 && !productTypes.includes(category)) {
        return res.status(403).json({ error: 'Basic plan allows only ONE product type. Upgrade to premium for multiple types.' });
      }
    }
    
    const imageUrls = req.files.map(file => `/uploads/${file.filename}`);
    const newProduct = {
      id: uuidv4(),
      sellerId: req.user.id,
      title, description,
      price: parseFloat(price),
      currency: currency || 'USD',
      category, condition,
      images: imageUrls,
      location: location || '',
      brand: brand || '',
      sellerPhone: phoneNumber || user.phone,
      createdAt: new Date().toISOString(),
      status: 'active',
      views: 0,
      likes: 0,
      sold: false
    };
    
    db.products.push(newProduct);
    writeDB(db);
    res.json(newProduct);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============= ORDER ROUTES WITH 20% COMMISSION =============
app.post('/api/orders', authenticateToken, async (req, res) => {
  try {
    const { productId, buyerMessage } = req.body;
    const db = readDB();
    const product = db.products.find(p => p.id === productId);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    if (product.sold) return res.status(400).json({ error: 'Product already sold' });
    
    const seller = db.users.find(u => u.id === product.sellerId);
    const buyer = db.users.find(u => u.id === req.user.id);
    
    // Calculate commission (20%)
    const commission = product.price * 0.20;
    const sellerEarning = product.price - commission;
    
    // Create order
    const order = {
      id: uuidv4(),
      productId,
      productTitle: product.title,
      productPrice: product.price,
      sellerId: product.sellerId,
      buyerId: req.user.id,
      commission,
      sellerEarning,
      status: 'pending',
      buyerMessage: buyerMessage || '',
      createdAt: new Date().toISOString()
    };
    
    db.orders.push(order);
    
    // Mark product as sold
    product.sold = true;
    product.status = 'sold';
    
    // Update seller balance
    const sellerIndex = db.users.findIndex(u => u.id === product.sellerId);
    db.users[sellerIndex].balance += sellerEarning;
    db.users[sellerIndex].totalEarned += sellerEarning;
    db.users[sellerIndex].totalSales += 1;
    
    // Update platform account
    db.platformAccount.balance += commission;
    db.platformAccount.totalEarned += commission;
    db.analytics.totalCommission += commission;
    db.analytics.totalSales += 1;
    
    // Create transaction record
    db.transactions.push({
      id: uuidv4(),
      orderId: order.id,
      sellerId: product.sellerId,
      buyerId: req.user.id,
      amount: product.price,
      commission,
      sellerEarning,
      status: 'completed',
      createdAt: new Date().toISOString()
    });
    
    writeDB(db);
    
    // Notify seller via socket
    io.to(`user_${product.sellerId}`).emit('new_order', { order, product });
    
    res.json({ success: true, order, commission, sellerEarning });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============= WITHDRAWAL ROUTES =============
app.post('/api/withdraw', authenticateToken, async (req, res) => {
  try {
    const { amount, bankCard, bankName } = req.body;
    const db = readDB();
    const userIndex = db.users.findIndex(u => u.id === req.user.id);
    if (userIndex === -1) return res.status(404).json({ error: 'User not found' });
    
    if (db.users[userIndex].balance < amount) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }
    
    if (amount < 10) {
      return res.status(400).json({ error: 'Minimum withdrawal amount is $10' });
    }
    
    // Create withdrawal request
    const withdrawal = {
      id: uuidv4(),
      userId: req.user.id,
      amount,
      bankCard: bankCard || db.users[userIndex].bankCard,
      bankName: bankName || db.users[userIndex].bankName,
      status: 'pending', // pending, completed, rejected
      requestedAt: new Date().toISOString(),
      processedAt: null
    };
    
    db.withdrawals.push(withdrawal);
    
    // Deduct from user balance (pending approval)
    db.users[userIndex].balance -= amount;
    db.users[userIndex].totalWithdrawn += amount;
    
    writeDB(db);
    res.json({ success: true, withdrawal, message: 'Withdrawal request submitted. Will be processed within 24-48 hours.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/withdrawals', authenticateToken, (req, res) => {
  const db = readDB();
  const withdrawals = db.withdrawals.filter(w => w.userId === req.user.id);
  res.json(withdrawals);
});

// ============= PLATFORM ACCOUNT ROUTE (For Admin) =============
app.get('/api/platform/account', authenticateToken, (req, res) => {
  // Check if user is admin (you can set first user as admin)
  const db = readDB();
  const user = db.users.find(u => u.id === req.user.id);
  if (user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  res.json(db.platformAccount);
});

// ============= PRODUCT ROUTES =============
app.get('/api/products', (req, res) => {
  const db = readDB();
  const { category, search } = req.query;
  let products = db.products.filter(p => p.status === 'active' && !p.sold);
  
  if (category && category !== 'all') products = products.filter(p => p.category === category);
  if (search) products = products.filter(p => p.title.toLowerCase().includes(search.toLowerCase()));
  
  products = products.map(product => {
    const seller = db.users.find(u => u.id === product.sellerId);
    return { ...product, seller: seller ? { fullName: seller.fullName, phone: seller.phone, rating: seller.rating } : null };
  });
  
  res.json(products.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
});

app.get('/api/products/:id', (req, res) => {
  const db = readDB();
  const product = db.products.find(p => p.id === req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  
  product.views++;
  const seller = db.users.find(u => u.id === product.sellerId);
  writeDB(db);
  
  res.json({ ...product, seller: seller ? { fullName: seller.fullName, phone: seller.sellerPhone || seller.phone, email: seller.email, rating: seller.rating } : null });
});

app.get('/api/my-products', authenticateToken, (req, res) => {
  const db = readDB();
  res.json(db.products.filter(p => p.sellerId === req.user.id));
});

app.delete('/api/products/:id', authenticateToken, (req, res) => {
  const db = readDB();
  const index = db.products.findIndex(p => p.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Not found' });
  if (db.products[index].sellerId !== req.user.id) return res.status(403).json({ error: 'Unauthorized' });
  
  db.products.splice(index, 1);
  writeDB(db);
  res.json({ message: 'Deleted' });
});

// ============= ORDER ROUTES =============
app.get('/api/my-orders', authenticateToken, (req, res) => {
  const db = readDB();
  const orders = db.orders.filter(o => o.buyerId === req.user.id || o.sellerId === req.user.id);
  res.json(orders);
});

app.get('/api/my-sales', authenticateToken, (req, res) => {
  const db = readDB();
  const sales = db.orders.filter(o => o.sellerId === req.user.id);
  const totalEarned = sales.reduce((sum, s) => sum + s.sellerEarning, 0);
  res.json({ sales, totalEarned });
});

// ============= CHAT ROUTES =============
app.post('/api/chats', authenticateToken, (req, res) => {
  const { productId, buyerId } = req.body;
  const db = readDB();
  const product = db.products.find(p => p.id === productId);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  
  let chat = db.chats.find(c => c.productId === productId && 
    ((c.buyerId === buyerId && c.sellerId === product.sellerId) || 
     (c.buyerId === product.sellerId && c.sellerId === buyerId)));
  
  if (!chat) {
    chat = {
      id: uuidv4(),
      productId, productTitle: product.title, productImage: product.images[0],
      sellerId: product.sellerId, buyerId,
      createdAt: new Date().toISOString(), lastMessage: null
    };
    db.chats.push(chat);
    writeDB(db);
  }
  res.json(chat);
});

app.get('/api/chats', authenticateToken, (req, res) => {
  const db = readDB();
  const chats = db.chats.filter(c => c.sellerId === req.user.id || c.buyerId === req.user.id);
  const enriched = chats.map(chat => {
    const messages = db.messages.filter(m => m.chatId === chat.id);
    const other = db.users.find(u => u.id === (chat.sellerId === req.user.id ? chat.buyerId : chat.sellerId));
    return { ...chat, messages, otherUser: other ? { id: other.id, fullName: other.fullName, avatar: other.avatar, phone: other.phone } : null };
  });
  res.json(enriched);
});

app.get('/api/chats/:chatId/messages', authenticateToken, (req, res) => {
  const db = readDB();
  res.json(db.messages.filter(m => m.chatId === req.params.chatId));
});

// ============= FORGOT PASSWORD =============
app.post('/api/forgot-password', async (req, res) => {
  const { email } = req.body;
  const db = readDB();
  const user = db.users.find(u => u.email === email);
  if (!user) return res.json({ success: true, message: 'If email exists, reset link sent' });
  
  const token = crypto.randomBytes(32).toString('hex');
  db.passwordResets = db.passwordResets || [];
  db.passwordResets.push({ email, token, expiresAt: new Date(Date.now() + 3600000).toISOString() });
  writeDB(db);
  
  res.json({ success: true, message: 'Reset link sent', resetToken: token });
});

app.post('/api/reset-password', async (req, res) => {
  const { token, newPassword } = req.body;
  const db = readDB();
  const reset = db.passwordResets?.find(r => r.token === token && new Date(r.expiresAt) > new Date());
  if (!reset) return res.status(400).json({ error: 'Invalid or expired token' });
  
  const userIndex = db.users.findIndex(u => u.email === reset.email);
  if (userIndex === -1) return res.status(404).json({ error: 'User not found' });
  
  db.users[userIndex].password = await bcrypt.hash(newPassword, 10);
  db.passwordResets = db.passwordResets.filter(r => r.token !== token);
  writeDB(db);
  res.json({ success: true });
});

// ============= STATS =============
app.get('/api/stats', (req, res) => {
  const db = readDB();
  res.json({
    totalProducts: db.products.filter(p => p.status === 'active').length,
    totalUsers: db.users.length,
    totalSales: db.analytics.totalSales,
    totalCommission: db.analytics.totalCommission
  });
});

// ============= SOCKET.IO =============
const connectedUsers = new Map();

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Auth required'));
  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return next(new Error('Invalid token'));
    socket.user = user;
    next();
  });
});

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.user.id}`);
  connectedUsers.set(socket.user.id, socket.id);
  socket.join(`user_${socket.user.id}`);
  
  socket.on('join_chat', (chatId) => socket.join(`chat_${chatId}`));
  
  socket.on('send_message', async (data) => {
    const { chatId, message } = data;
    const db = readDB();
    const chat = db.chats.find(c => c.id === chatId);
    if (!chat || (chat.sellerId !== socket.user.id && chat.buyerId !== socket.user.id)) return;
    
    const newMsg = {
      id: uuidv4(), chatId, senderId: socket.user.id, message,
      timestamp: new Date().toISOString(), read: false
    };
    db.messages.push(newMsg);
    chat.lastMessage = { message: message.substring(0, 50), timestamp: newMsg.timestamp, senderId: socket.user.id };
    writeDB(db);
    
    io.to(`chat_${chatId}`).emit('new_message', newMsg);
    const otherId = chat.sellerId === socket.user.id ? chat.buyerId : chat.sellerId;
    io.to(`user_${otherId}`).emit('message_notification', { chatId, message: newMsg });
  });
  
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.user.id}`);
    connectedUsers.delete(socket.user.id);
  });
});

// ============= SERVE FRONTEND =============
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============= START =============
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 MarketHub Server running on port ${PORT}`);
  console.log(`📍 http://localhost:${PORT}`);
});
