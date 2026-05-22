// ============= COMPLETE FIXED server.js =============
require('dotenv').config(); // MUST BE FIRST!

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

// CHECK IF JWT_SECRET IS SET
if (!process.env.JWT_SECRET) {
    console.error('❌ FATAL ERROR: JWT_SECRET is not defined in .env file!');
    console.error('Please create .env file with: JWT_SECRET=your_secret_key_here');
    process.exit(1);
}

console.log('✅ JWT_SECRET is set');

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

// Database functions
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
            platformAccount: { balance: 0, totalEarned: 0, totalWithdrawn: 0 },
            analytics: { pageViews: 0, totalSales: 0, totalUsers: 0, totalCommission: 0 },
            settings: {
                siteName: 'MarketHub Worldwide',
                siteEmail: 'support@markethub.com',
                commissionRate: 20,
                maintenanceMode: false,
                defaultCurrency: 'USD'
            }
        };
        fs.writeFileSync(DB_PATH, JSON.stringify(initialData, null, 2));
        console.log('✅ Database created');
    }
}

function readDB() {
    const data = fs.readFileSync(DB_PATH, 'utf8');
    return JSON.parse(data);
}

function writeDB(data) {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

initDB();

// Multer setup
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${Math.random().toString(36).substring(7)}${path.extname(file.originalname)}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = /jpeg|jpg|png|gif|webp/;
        cb(null, allowed.test(path.extname(file.originalname).toLowerCase()) && allowed.test(file.mimetype));
    }
});

// Auth middleware
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }
    
    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid or expired token' });
        }
        req.user = user;
        next();
    });
}

// ============= REGISTER ROUTE (Fixed) =============
app.post('/api/register', async (req, res) => {
    try {
        const { username, email, password, fullName, country, phone } = req.body;
        const db = readDB();
        
        // Check if email exists
        const existingEmail = db.users.find(u => u.email === email);
        if (existingEmail) {
            return res.status(400).json({ error: 'Email already registered. Please login instead.' });
        }
        
        // Check if username exists
        const existingUsername = db.users.find(u => u.username === username);
        if (existingUsername) {
            return res.status(400).json({ error: 'Username already taken. Please choose another.' });
        }
        
        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);
        
        const newUser = {
            id: uuidv4(),
            username,
            email,
            password: hashedPassword,
            fullName,
            country: country || 'Tanzania',
            phone: phone || '',
            balance: 0,
            totalEarned: 0,
            totalWithdrawn: 0,
            subscriptionActive: false,
            subscriptionExpiry: null,
            subscriptionType: null,
            createdAt: new Date().toISOString(),
            avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(fullName)}&background=random`,
            role: 'user',
            verified: false,
            rating: 0,
            totalSales: 0
        };
        
        db.users.push(newUser);
        db.analytics.totalUsers = db.users.length;
        writeDB(db);
        
        // Generate token - FIXED: using process.env.JWT_SECRET
        const token = jwt.sign(
            { id: newUser.id, username: newUser.username, email: newUser.email, role: newUser.role },
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );
        
        res.json({
            success: true,
            token,
            user: {
                id: newUser.id,
                username: newUser.username,
                email: newUser.email,
                fullName: newUser.fullName,
                avatar: newUser.avatar,
                role: newUser.role,
                balance: newUser.balance
            }
        });
        
    } catch (error) {
        console.error('Register error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============= LOGIN ROUTE (Fixed) =============
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const db = readDB();
        
        const user = db.users.find(u => u.email === email);
        if (!user) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        
        // Generate token - FIXED: using process.env.JWT_SECRET
        const token = jwt.sign(
            { id: user.id, username: user.username, email: user.email, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );
        
        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                fullName: user.fullName,
                avatar: user.avatar,
                role: user.role,
                balance: user.balance,
                totalEarned: user.totalEarned
            }
        });
        
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============= GET CURRENT USER =============
app.get('/api/me', authenticateToken, (req, res) => {
    const db = readDB();
    const user = db.users.find(u => u.id === req.user.id);
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }
    res.json(user);
});

// ============= SIMPLE PRODUCT ROUTES FOR TESTING =============
app.get('/api/products', (req, res) => {
    const db = readDB();
    const products = db.products.filter(p => p.status === 'active' && !p.sold);
    res.json(products);
});

app.post('/api/products', authenticateToken, upload.array('images', 5), (req, res) => {
    try {
        const { title, description, price, category, condition } = req.body;
        const db = readDB();
        
        const images = req.files.map(file => `/uploads/${file.filename}`);
        
        const newProduct = {
            id: uuidv4(),
            sellerId: req.user.id,
            title,
            description,
            price: parseFloat(price),
            currency: 'USD',
            category,
            condition,
            images: images.length ? images : [],
            createdAt: new Date().toISOString(),
            status: 'active',
            views: 0,
            sold: false
        };
        
        db.products.push(newProduct);
        writeDB(db);
        res.json(newProduct);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============= SERVE FRONTEND =============
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============= START SERVER =============
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`\n🚀 Server running on http://localhost:${PORT}`);
    console.log(`🔐 JWT_SECRET is ${process.env.JWT_SECRET ? 'SET ✅' : 'NOT SET ❌'}`);
    console.log(`📁 Database: ${DB_PATH}\n`);
});
