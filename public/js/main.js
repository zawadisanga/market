// Global variables
let currentUser = null;
let currentSocket = null;
let currentChatId = null;
let currentProduct = null;
const API_URL = window.location.origin;

document.addEventListener('DOMContentLoaded', () => {
    console.log('MarketHub Started');
    checkAuth();
    loadProducts();
    setupEventListeners();
});

// ============= AUTH =============
async function checkAuth() {
    const token = localStorage.getItem('token');
    if (token) {
        try {
            const res = await fetch(`${API_URL}/api/me`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const user = await res.json();
            if (!user.error) {
                currentUser = user;
                showUserMenu();
                connectSocket();
                loadDashboard();
            }
        } catch(e) { logout(); }
    }
}

function showUserMenu() {
    document.getElementById('authLinks').style.display = 'none';
    document.getElementById('userMenu').style.display = 'flex';
    document.getElementById('userName').textContent = currentUser.fullName.split(' ')[0];
    document.getElementById('userBalance').textContent = `$${currentUser.balance?.toFixed(2) || 0}`;
    document.getElementById('userAvatar').src = currentUser.avatar || 'https://ui-avatars.com/api/?name=User';
}

function logout() {
    localStorage.removeItem('token');
    currentUser = null;
    if (currentSocket) currentSocket.disconnect();
    location.reload();
}

// ============= SOCKET =============
function connectSocket() {
    const token = localStorage.getItem('token');
    if (!token) return;
    currentSocket = io(API_URL, { auth: { token } });
    currentSocket.on('connect', () => console.log('Socket connected'));
    currentSocket.on('new_message', (msg) => {
        if (currentChatId === msg.chatId) displayMessage(msg);
        loadChats();
    });
    currentSocket.on('new_order', (data) => {
        showToast(`New order for ${data.product.title}!`, 'info');
        loadDashboard();
    });
}

// ============= EVENT LISTENERS =============
function setupEventListeners() {
    document.getElementById('homeLink').onclick = (e) => { e.preventDefault(); showView('products'); loadProducts(); };
    document.getElementById('sellLink').onclick = (e) => { e.preventDefault(); if(!currentUser){ showToast('Login to sell','error'); showLoginModal(); return; } showView('sell'); };
    document.getElementById('messagesLink').onclick = (e) => { e.preventDefault(); if(!currentUser){ showLoginModal(); return; } showView('messages'); loadChats(); };
    document.getElementById('myProductsLink').onclick = (e) => { e.preventDefault(); if(!currentUser){ showLoginModal(); return; } showView('myProducts'); loadMyProducts(); };
    document.getElementById('dashboardLink').onclick = (e) => { e.preventDefault(); if(!currentUser){ showLoginModal(); return; } showView('dashboard'); loadDashboard(); };
    document.getElementById('loginBtn').onclick = () => showLoginModal();
    document.getElementById('registerBtn').onclick = () => showRegisterModal();
    document.getElementById('logoutBtn').onclick = () => logout();
    document.getElementById('withdrawBtn').onclick = () => showWithdrawModal();
    document.getElementById('withdrawDashboardBtn').onclick = () => showWithdrawModal();
    document.getElementById('heroSellBtn').onclick = () => currentUser ? showView('sell') : showLoginModal();
    document.getElementById('heroBrowseBtn').onclick = () => { showView('products'); loadProducts(); };
    document.getElementById('searchBtn').onclick = searchProducts;
    document.getElementById('searchInput').onkeypress = (e) => { if(e.key === 'Enter') searchProducts(); };
    
    document.getElementById('loginForm').onsubmit = login;
    document.getElementById('registerForm').onsubmit = register;
    document.getElementById('sellForm').onsubmit = submitProduct;
    document.getElementById('orderForm').onsubmit = confirmOrder;
    document.getElementById('withdrawForm').onsubmit = requestWithdrawal;
    document.getElementById('sendMessageBtn').onclick = sendMessage;
    document.getElementById('messageInput').onkeypress = (e) => { if(e.key === 'Enter') sendMessage(); };
    
    document.getElementById('subscribeBasicBtn').onclick = () => subscribe('basic');
    document.getElementById('subscribePremiumBtn').onclick = () => subscribe('premium');
    document.getElementById('upgradeBtn').onclick = () => showSubscribeModal();
    
    document.querySelectorAll('.close').forEach(btn => {
        btn.onclick = () => btn.closest('.modal').style.display = 'none';
    });
    
    document.getElementById('switchToRegister').onclick = (e) => { e.preventDefault(); document.getElementById('loginModal').style.display='none'; showRegisterModal(); };
    document.getElementById('switchToLogin').onclick = (e) => { e.preventDefault(); document.getElementById('registerModal').style.display='none'; showLoginModal(); };
    document.getElementById('forgotPasswordLink').onclick = (e) => { e.preventDefault(); document.getElementById('loginModal').style.display='none'; document.getElementById('forgotPasswordModal').style.display='block'; };
}

// ============= VIEWS =============
function showView(view) {
    const views = ['productsView', 'sellView', 'messagesView', 'myProductsView', 'dashboardView'];
    views.forEach(v => { const el = document.getElementById(v); if(el) el.style.display = 'none'; });
    document.getElementById(`${view}View`).style.display = 'block';
}

function showLoginModal() { document.getElementById('loginModal').style.display = 'block'; }
function showRegisterModal() { document.getElementById('registerModal').style.display = 'block'; }
function showWithdrawModal() { 
    if(!currentUser){ showToast('Login first','error'); return; }
    document.getElementById('withdrawModal').style.display = 'block';
}
function showSubscribeModal() { document.getElementById('sellView').style.display = 'block'; window.scrollTo({top:0}); }

function showToast(msg, type='success') {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.style.background = type === 'error' ? '#EF4444' : '#10B981';
    toast.style.display = 'block';
    setTimeout(() => toast.style.display = 'none', 3000);
}

// ============= AUTH API =============
async function login(e) {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    try {
        const res = await fetch(`${API_URL}/api/login`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if(data.token) {
            localStorage.setItem('token', data.token);
            currentUser = data.user;
            showUserMenu();
            document.getElementById('loginModal').style.display = 'none';
            connectSocket();
            loadProducts();
            showToast(`Welcome back, ${data.user.fullName}!`);
        } else { showToast(data.error || 'Login failed', 'error'); }
    } catch(e) { showToast('Network error', 'error'); }
}

async function register(e) {
    e.preventDefault();
    const password = document.getElementById('regPassword').value;
    const confirm = document.getElementById('regConfirmPassword').value;
    if(password !== confirm) { showToast('Passwords do not match!', 'error'); return; }
    if(password.length < 6) { showToast('Password must be 6+ chars', 'error'); return; }
    
    const userData = {
        fullName: document.getElementById('regFullName').value,
        username: document.getElementById('regUsername').value,
        email: document.getElementById('regEmail').value,
        phone: document.getElementById('regPhone').value,
        bankCard: document.getElementById('regBankCard').value,
        bankName: document.getElementById('regBankName').value,
        password: password
    };
    try {
        const res = await fetch(`${API_URL}/api/register`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(userData)
        });
        const data = await res.json();
        if(data.token) {
            localStorage.setItem('token', data.token);
            currentUser = data.user;
            showUserMenu();
            document.getElementById('registerModal').style.display = 'none';
            showToast(`Welcome to MarketHub! Please subscribe to start selling.`);
            showView('sell');
        } else { showToast(data.error || 'Registration failed', 'error'); }
    } catch(e) { showToast('Network error', 'error'); }
}

async function subscribe(type) {
    if(!currentUser) { showLoginModal(); return; }
    try {
        const res = await fetch(`${API_URL}/api/subscribe`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
            body: JSON.stringify({ type })
        });
        const data = await res.json();
        if(data.success) {
            showToast(data.message, 'success');
            currentUser.subscriptionActive = true;
            loadDashboard();
        } else { showToast(data.error, 'error'); }
    } catch(e) { showToast('Network error', 'error'); }
}

// ============= PRODUCTS =============
async function loadProducts() {
    try {
        const res = await fetch(`${API_URL}/api/products`);
        const products = await res.json();
        const grid = document.getElementById('productsGrid');
        if(!products.length) { grid.innerHTML = '<p>No products found</p>'; return; }
        grid.innerHTML = products.map(p => `
            <div class="product-card" ondblclick="showProductDetail('${p.id}')">
                <img src="${p.images?.[0] || 'https://via.placeholder.com/300'}" onerror="this.src='https://via.placeholder.com/300'">
                <h3>${escapeHtml(p.title)}</h3>
                <div class="price">$${p.price}</div>
                <div class="seller">${escapeHtml(p.seller?.fullName || 'Unknown')}</div>
                <div class="actions">
                    <button onclick="event.stopPropagation(); contactSeller('${p.id}', '${p.seller?.phone || ''}')"><i class="fas fa-phone"></i> Call</button>
                    <button onclick="event.stopPropagation(); startChat('${p.id}')"><i class="fas fa-comment"></i> Chat</button>
                    <button onclick="event.stopPropagation(); showBuyModal('${p.id}')" class="buy-btn">Buy Now</button>
                </div>
            </div>
        `).join('');
    } catch(e) { console.error(e); }
}

window.showProductDetail = async function(productId) {
    try {
        const res = await fetch(`${API_URL}/api/products/${productId}`);
        const p = await res.json();
        const modal = document.getElementById('productModal');
        document.getElementById('productDetail').innerHTML = `
            <h2>${escapeHtml(p.title)}</h2>
            <img src="${p.images?.[0] || 'https://via.placeholder.com/400'}" style="max-width:100%">
            <div class="price-large">$${p.price}</div>
            <p><strong>Description:</strong> ${escapeHtml(p.description)}</p>
            <p><strong>Category:</strong> ${p.category} | <strong>Condition:</strong> ${p.condition}</p>
            <p><strong>Location:</strong> ${p.location || 'N/A'}</p>
            <p><strong>Seller:</strong> ${escapeHtml(p.seller?.fullName)}</p>
            <p><strong>Contact:</strong> <a href="tel:${p.seller?.phone}">${p.seller?.phone || 'Not provided'}</a></p>
            <div class="modal-actions">
                <button onclick="contactSeller('${p.id}', '${p.seller?.phone}')"><i class="fas fa-phone"></i> Call Seller</button>
                <button onclick="startChat('${p.id}')"><i class="fas fa-comment"></i> Chat</button>
                <button onclick="showBuyModal('${p.id}')" class="buy-btn">Buy Now</button>
            </div>
        `;
        modal.style.display = 'block';
    } catch(e) { console.error(e); }
};

window.contactSeller = function(productId, phone) {
    if(phone && phone !== 'Not provided') {
        window.location.href = `tel:${phone}`;
    } else {
        showToast('Seller phone number not available. Use chat instead.', 'error');
        startChat(productId);
    }
};

window.startChat = async function(productId) {
    if(!currentUser) { showLoginModal(); return; }
    try {
        const res = await fetch(`${API_URL}/api/chats`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
            body: JSON.stringify({ productId, buyerId: currentUser.id })
        });
        const chat = await res.json();
        showView('messages');
        loadChats();
        setTimeout(() => openChat(chat.id), 500);
    } catch(e) { showToast('Error starting chat', 'error'); }
};

window.showBuyModal = function(productId) {
    if(!currentUser) { showLoginModal(); return; }
    currentProduct = productId;
    document.getElementById('orderModal').style.display = 'block';
};

async function confirmOrder(e) {
    e.preventDefault();
    const message = document.getElementById('buyerMessage').value;
    try {
        const res = await fetch(`${API_URL}/api/orders`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
            body: JSON.stringify({ productId: currentProduct, buyerMessage: message })
        });
        const data = await res.json();
        if(data.success) {
            showToast(`Purchase confirmed! Commission: $${data.commission.toFixed(2)}`, 'success');
            document.getElementById('orderModal').style.display = 'none';
            loadProducts();
            loadDashboard();
        } else { showToast(data.error, 'error'); }
    } catch(e) { showToast('Network error', 'error'); }
}

async function submitProduct(e) {
    e.preventDefault();
    if(!currentUser) { showToast('Login first', 'error'); return; }
    const formData = new FormData(e.target);
    try {
        const res = await fetch(`${API_URL}/api/products`, {
            method: 'POST', headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
            body: formData
        });
        if(res.ok) {
            showToast('Product listed!');
            showView('products');
            loadProducts();
            e.target.reset();
        } else {
            const err = await res.json();
            showToast(err.error || 'Error listing product', 'error');
        }
    } catch(e) { showToast('Network error', 'error'); }
}

function searchProducts() {
    // Implement search
    loadProducts();
}

// ============= MY PRODUCTS =============
async function loadMyProducts() {
    if(!currentUser) return;
    try {
        const res = await fetch(`${API_URL}/api/my-products`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        const products = await res.json();
        const grid = document.getElementById('myProductsGrid');
        if(!products.length) { grid.innerHTML = '<p>No products listed</p>'; return; }
        grid.innerHTML = products.map(p => `
            <div class="product-card">
                <img src="${p.images?.[0] || 'https://via.placeholder.com/300'}">
                <h3>${escapeHtml(p.title)}</h3>
                <div class="price">$${p.price}</div>
                <div class="status ${p.sold ? 'sold' : 'active'}">${p.sold ? 'SOLD' : 'ACTIVE'}</div>
                <button onclick="deleteProduct('${p.id}')" class="delete-btn">Delete</button>
            </div>
        `).join('');
    } catch(e) { console.error(e); }
}

window.deleteProduct = async function(id) {
    if(!confirm('Delete this product?')) return;
    try {
        await fetch(`${API_URL}/api/products/${id}`, {
            method: 'DELETE', headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        showToast('Product deleted');
        loadMyProducts();
        loadProducts();
    } catch(e) { showToast('Error', 'error'); }
};

// ============= DASHBOARD =============
async function loadDashboard() {
    if(!currentUser) return;
    try {
        const res = await fetch(`${API_URL}/api/me`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        const user = await res.json();
        document.getElementById('dashboardBalance').innerHTML = `$${user.balance?.toFixed(2) || 0}`;
        document.getElementById('totalEarned').innerHTML = `$${user.totalEarned?.toFixed(2) || 0}`;
        document.getElementById('totalSales').innerHTML = user.totalSales || 0;
        document.getElementById('subscriptionStatus').innerHTML = user.subscriptionActive ? `Active (${user.subscriptionType}) until ${new Date(user.subscriptionExpiry).toLocaleDateString()}` : 'Not Active';
        
        // Load orders/sales
        const salesRes = await fetch(`${API_URL}/api/my-sales`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        const sales = await salesRes.json();
        document.getElementById('transactionsList').innerHTML = sales.sales.map(s => `
            <div>Sold: ${s.productTitle} - $${s.sellerEarning.toFixed(2)} earned (${new Date(s.createdAt).toLocaleDateString()})</div>
        `).join('') || '<div>No transactions yet</div>';
        
        const withdrawRes = await fetch(`${API_URL}/api/withdrawals`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        const withdrawals = await withdrawRes.json();
        document.getElementById('withdrawalsList').innerHTML = withdrawals.map(w => `
            <div>$${w.amount} - ${w.status} (${new Date(w.requestedAt).toLocaleDateString()})</div>
        `).join('') || '<div>No withdrawals yet</div>';
    } catch(e) { console.error(e); }
}

async function requestWithdrawal(e) {
    e.preventDefault();
    const amount = parseFloat(document.getElementById('withdrawAmount').value);
    const bankCard = document.getElementById('withdrawBankCard').value;
    const bankName = document.getElementById('withdrawBankName').value;
    if(amount < 10) { showToast('Minimum $10', 'error'); return; }
    try {
        const res = await fetch(`${API_URL}/api/withdraw`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
            body: JSON.stringify({ amount, bankCard, bankName })
        });
        const data = await res.json();
        if(data.success) {
            showToast(data.message, 'success');
            document.getElementById('withdrawModal').style.display = 'none';
            loadDashboard();
            document.getElementById('userBalance').textContent = `$${(currentUser.balance - amount).toFixed(2)}`;
        } else { showToast(data.error, 'error'); }
    } catch(e) { showToast('Network error', 'error'); }
}

// ============= CHAT =============
async function loadChats() {
    if(!currentUser) return;
    try {
        const res = await fetch(`${API_URL}/api/chats`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        const chats = await res.json();
        const list = document.getElementById('chatsList');
        if(!chats.length) { list.innerHTML = '<p>No conversations</p>'; return; }
        list.innerHTML = chats.map(c => `
            <div class="chat-item" onclick="openChat('${c.id}')">
                <img src="${c.otherUser?.avatar || 'https://ui-avatars.com/api/?name=User'}">
                <div><strong>${escapeHtml(c.otherUser?.fullName)}</strong><br>${c.productTitle}</div>
            </div>
        `).join('');
    } catch(e) { console.error(e); }
}

window.openChat = async function(chatId) {
    currentChatId = chatId;
    try {
        const res = await fetch(`${API_URL}/api/chats/${chatId}/messages`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        const messages = await res.json();
        const container = document.getElementById('chatMessages');
        container.innerHTML = messages.map(m => `
            <div class="message ${m.senderId === currentUser?.id ? 'sent' : 'received'}">
                <div>${escapeHtml(m.message)}</div>
                <div class="time">${new Date(m.timestamp).toLocaleTimeString()}</div>
            </div>
        `).join('');
        container.scrollTop = container.scrollHeight;
        if(currentSocket) currentSocket.emit('join_chat', chatId);
    } catch(e) { console.error(e); }
};

function sendMessage() {
    const input = document.getElementById('messageInput');
    const msg = input.value.trim();
    if(!msg || !currentChatId || !currentSocket) return;
    currentSocket.emit('send_message', { chatId: currentChatId, message: msg });
    input.value = '';
}

function displayMessage(msg) {
    const container = document.getElementById('chatMessages');
    container.innerHTML += `
        <div class="message ${msg.senderId === currentUser?.id ? 'sent' : 'received'}">
            <div>${escapeHtml(msg.message)}</div>
            <div class="time">${new Date(msg.timestamp).toLocaleTimeString()}</div>
        </div>
    `;
    container.scrollTop = container.scrollHeight;
}

function escapeHtml(text) {
    if(!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
