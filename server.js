require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

// ============ Config ============
const CONFIG = {
  upstream: {
    baseUrl: 'https://api.quickrouter.ai',
    apiKey: process.env.UPSTREAM_API_KEY || '',
  },
  defaultMultiplier: 1.2,
  modelMultipliers: {
    'gpt-4o': 1.2, 'gpt-4o-mini': 1.2, 'gpt-4-turbo': 1.2, 'gpt-3.5-turbo': 1.2,
    'claude-sonnet-4-20250514': 1.25, 'claude-3-5-sonnet-20241022': 1.25,
    'claude-3-opus-20240229': 1.25, 'claude-3-haiku-20240307': 1.25,
    'gemini-2.0-flash': 1.3, 'gemini-1.5-pro': 1.3, 'gemini-1.5-flash': 1.3,
    'deepseek-chat': 1.3, 'deepseek-coder': 1.3, 'grok-2': 1.2, 'grok-beta': 1.2,
  },
  signupBonus: 1.0,
  models: [
    { id: 'gpt-4o', name: 'GPT-4o', provider: 'OpenAI', input: 2.5, output: 10, context: '128K', tags: ['recommended'] },
    { id: 'gpt-4o-mini', name: 'GPT-4o mini', provider: 'OpenAI', input: 0.15, output: 0.6, context: '128K', tags: ['cheap'] },
    { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', provider: 'OpenAI', input: 10, output: 30, context: '128K', tags: [] },
    { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', provider: 'OpenAI', input: 0.5, output: 1.5, context: '16K', tags: ['cheap'] },
    { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', provider: 'Anthropic', input: 3, output: 15, context: '200K', tags: ['reasoning'] },
    { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', provider: 'Anthropic', input: 3, output: 15, context: '200K', tags: ['reasoning'] },
    { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', provider: 'Anthropic', input: 15, output: 75, context: '200K', tags: [] },
    { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku', provider: 'Anthropic', input: 0.25, output: 1.25, context: '200K', tags: ['cheap'] },
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', provider: 'Google', input: 0.1, output: 0.4, context: '1M', tags: ['cheap'] },
    { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', provider: 'Google', input: 1.25, output: 5, context: '2M', tags: [] },
    { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', provider: 'Google', input: 0.075, output: 0.3, context: '1M', tags: ['cheap'] },
    { id: 'deepseek-chat', name: 'DeepSeek Chat', provider: 'DeepSeek', input: 0.14, output: 0.28, context: '64K', tags: ['cn'] },
    { id: 'deepseek-coder', name: 'DeepSeek Coder', provider: 'DeepSeek', input: 0.14, output: 0.28, context: '64K', tags: ['cn'] },
    { id: 'grok-2', name: 'Grok 2', provider: 'xAI', input: 2, output: 10, context: '128K', tags: ['new'] },
  ],
};

// ============ Pure JS JSON Database ============
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

function readJSON(file, defaultVal = []) {
  const filePath = path.join(dataDir, file);
  try {
    if (!fs.existsSync(filePath)) return defaultVal;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) { return defaultVal; }
}

function writeJSON(file, data) {
  const filePath = path.join(dataDir, file);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

// Payment config (QR code URLs + crypto)
function getPaymentConfig() {
  return readJSON('payment_config.json', {
    wechat_qr: '', alipay_qr: '', contact: '',
    bnb_address: '', bnb_usdt_note: 'USDT(BEP20) 或 BNB 均可，付款后提交交易哈希'
  });
}
function setPaymentConfig(cfg) {
  writeJSON('payment_config.json', cfg);
}

// ============ DB Helpers ============
function findUser(by, val) {
  return readJSON('users.json').find(u => u[by] === val && u.status === 'active');
}
function getUserById(id) {
  return readJSON('users.json').find(u => u.id === id);
}
function updateUser(id, updates) {
  const users = readJSON('users.json');
  const idx = users.findIndex(u => u.id === id);
  if (idx === -1) return;
  users[idx] = { ...users[idx], ...updates };
  writeJSON('users.json', users);
}
function getAllUsers() { return readJSON('users.json'); }

function findToken(key) {
  return readJSON('tokens.json').find(t => t.key === key && t.status === 'active');
}
function getUserTokens(userId) {
  return readJSON('tokens.json').filter(t => t.user_id === userId);
}
function addToken(userId, name, quota_limit) {
  const tokens = readJSON('tokens.json');
  const token = {
    id: uuidv4(), user_id: userId, name: name || 'default',
    key: 'sk-' + crypto.randomBytes(24).toString('hex'),
    quota_limit: quota_limit || 0, used_quota: 0, status: 'active',
    created_at: new Date().toISOString(),
  };
  tokens.push(token);
  writeJSON('tokens.json', tokens);
  return token;
}
function deleteToken(id, userId) {
  let tokens = readJSON('tokens.json');
  tokens = tokens.filter(t => !(t.id === id && t.user_id === userId));
  writeJSON('tokens.json', tokens);
}
function updateToken(id, userId, updates) {
  const tokens = readJSON('tokens.json');
  const idx = tokens.findIndex(t => t.id === id && t.user_id === userId);
  if (idx === -1) return;
  tokens[idx] = { ...tokens[idx], ...updates };
  writeJSON('tokens.json', tokens);
}

// Recharge orders helpers
function getRechargeOrders() { return readJSON('recharge_orders.json', []); }
function saveRechargeOrders(orders) { writeJSON('recharge_orders.json', orders); }
function addRechargeOrder(order) {
  const orders = getRechargeOrders();
  orders.push(order);
  saveRechargeOrders(orders);
  return order;
}
function updateRechargeOrder(id, updates) {
  const orders = getRechargeOrders();
  const idx = orders.findIndex(o => o.id === id);
  if (idx === -1) return null;
  orders[idx] = { ...orders[idx], ...updates, updated_at: new Date().toISOString() };
  saveRechargeOrders(orders);
  return orders[idx];
}

function addUsageLog(userId, tokenId, model, inputTokens, outputTokens, cost) {
  const logs = readJSON('usage_logs.json', []);
  logs.push({
    id: logs.length + 1, user_id: userId, token_id: tokenId, model,
    input_tokens: inputTokens, output_tokens: outputTokens,
    cost, status: 'success', created_at: new Date().toISOString(),
  });
  if (logs.length > 10000) logs.splice(0, logs.length - 10000);
  writeJSON('usage_logs.json', logs);
}

function getTotalUsage() {
  return readJSON('usage_logs.json', []).reduce((sum, l) => sum + (l.cost || 0), 0);
}
function getTodayUsage() {
  const today = new Date().toISOString().split('T')[0];
  return readJSON('usage_logs.json', []).filter(l => l.created_at.startsWith(today)).reduce((sum, l) => sum + (l.cost || 0), 0);
}
function getTodayRequests() {
  const today = new Date().toISOString().split('T')[0];
  return readJSON('usage_logs.json', []).filter(l => l.created_at.startsWith(today)).length;
}

// ============ Init Admin ============
function initAdmin() {
  const users = readJSON('users.json', []);
  if (!users.find(u => u.role === 'admin')) {
    users.push({
      id: uuidv4(), username: 'admin', email: 'admin@localhost',
      password: bcrypt.hashSync('admin123', 10), role: 'admin',
      balance: 1000, used_quota: 0, status: 'active',
      created_at: new Date().toISOString(),
    });
    writeJSON('users.json', users);
    console.log('\n=========== Admin account created ===========');
    console.log('  Username: admin');
    console.log('  Password: admin123');
    console.log('==============================================\n');
  }
}

// ============ Middleware ============
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use((req, res, next) => {
  if (!req.path.startsWith('/v1/')) {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  }
  next();
});

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.token;
  if (!token) return res.status(401).json({ error: { message: 'Unauthorized' } });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = getUserById(decoded.userId);
    if (!user || user.status !== 'active') return res.status(401).json({ error: { message: 'Unauthorized' } });
    req.user = user;
    next();
  } catch (e) { return res.status(401).json({ error: { message: 'Invalid token' } }); }
}

function adminMiddleware(req, res, next) {
  authMiddleware(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: { message: 'Forbidden' } });
    next();
  });
}

function apiKeyAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: { message: 'Missing API key. Set Authorization: Bearer sk-xxx' } });
  }
  const apiKey = authHeader.replace('Bearer ', '');
  const token = findToken(apiKey);
  if (!token) return res.status(401).json({ error: { message: 'Invalid API key' } });
  const user = getUserById(token.user_id);
  if (!user) return res.status(401).json({ error: { message: 'User inactive' } });
  if (user.balance <= 0) return res.status(402).json({ error: { message: 'Insufficient balance. Please recharge.' } });
  req.token = token;
  req.user = user;
  next();
}

// ============ Auth Routes ============
app.post('/api/auth/register', (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) return res.status(400).json({ error: { message: 'All fields required' } });
  if (password.length < 6) return res.status(400).json({ error: { message: 'Password must be at least 6 characters' } });
  if (readJSON('users.json', []).find(u => u.username === username || u.email === email)) {
    return res.status(409).json({ error: { message: 'Username or email already exists' } });
  }
  const userId = uuidv4();
  const hashedPassword = bcrypt.hashSync(password, 10);
  const users = readJSON('users.json', []);
  users.push({
    id: userId, username, email,
    password: hashedPassword, role: 'user',
    balance: CONFIG.signupBonus, used_quota: 0,
    status: 'active', created_at: new Date().toISOString(),
  });
  writeJSON('users.json', users);
  const token = jwt.sign({ userId }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ success: true, token, user: { id: userId, username, email, balance: CONFIG.signupBonus } });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: { message: 'Username and password required' } });
  const user = readJSON('users.json', []).find(u => (u.username === username || u.email === username) && u.status === 'active');
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: { message: 'Invalid credentials' } });
  }
  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
  res.json({
    success: true, token,
    user: { id: user.id, username: user.username, email: user.email, balance: user.balance, role: user.role }
  });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({
    success: true,
    user: {
      id: req.user.id, username: req.user.username, email: req.user.email,
      balance: req.user.balance, used_quota: req.user.used_quota,
      role: req.user.role, created_at: req.user.created_at,
    }
  });
});

// ============ Token Management ============
app.get('/api/tokens', authMiddleware, (req, res) => {
  res.json({ success: true, data: getUserTokens(req.user.id) });
});

app.post('/api/tokens', authMiddleware, (req, res) => {
  const { name, quota_limit } = req.body;
  const token = addToken(req.user.id, name, quota_limit);
  res.json({ success: true, data: { id: token.id, key: token.key, name: token.name, quota_limit: token.quota_limit } });
});

app.delete('/api/tokens/:id', authMiddleware, (req, res) => {
  deleteToken(req.params.id, req.user.id);
  res.json({ success: true });
});

app.put('/api/tokens/:id', authMiddleware, (req, res) => {
  updateToken(req.params.id, req.user.id, req.body);
  res.json({ success: true });
});

// ============ Usage Stats ============
app.get('/api/usage', authMiddleware, (req, res) => {
  const days = parseInt(req.query.days) || 7;
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const logs = readJSON('usage_logs.json', []).filter(l => l.user_id === req.user.id && l.created_at >= since);
  res.json({ success: true, data: logs });
});

app.get('/api/usage/recent', authMiddleware, (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const logs = readJSON('usage_logs.json', []).filter(l => l.user_id === req.user.id).slice(-limit).reverse();
  res.json({ success: true, data: logs });
});

// ============ Models ============
app.get('/api/models', (req, res) => {
  const models = CONFIG.models.map(m => {
    const multiplier = CONFIG.modelMultipliers[m.id] || CONFIG.defaultMultiplier;
    return { ...m,
      input_price: (m.input * multiplier).toFixed(4),
      output_price: (m.output * multiplier).toFixed(4),
      multiplier,
    };
  });
  res.json({ success: true, data: models });
});

// ============ PAYMENT CONFIG (Public) ============
app.get('/api/payment/config', (req, res) => {
  const cfg = getPaymentConfig();
  res.json({
    success: true,
    data: {
      wechat_qr: cfg.wechat_qr || '',
      alipay_qr: cfg.alipay_qr || '',
      contact: cfg.contact || '',
      bnb_address: cfg.bnb_address || '',
      bnb_usdt_note: cfg.bnb_usdt_note || '',
    }
  });
});

// ============ PAYMENT CONFIG (Admin) ============
app.post('/api/admin/payment/config', adminMiddleware, (req, res) => {
  const { wechat_qr, alipay_qr, contact, bnb_address, bnb_usdt_note } = req.body;
  const cfg = getPaymentConfig();
  if (wechat_qr !== undefined) cfg.wechat_qr = wechat_qr;
  if (alipay_qr !== undefined) cfg.alipay_qr = alipay_qr;
  if (contact !== undefined) cfg.contact = contact;
  if (bnb_address !== undefined) cfg.bnb_address = bnb_address;
  if (bnb_usdt_note !== undefined) cfg.bnb_usdt_note = bnb_usdt_note;
  setPaymentConfig(cfg);
  res.json({ success: true, data: cfg });
});

// ============ RECHARGE FLOW ============

// Step 1: User creates a recharge order (after paying)
app.post('/api/recharge/order', authMiddleware, (req, res) => {
  const { amount, note, payment_method, tx_hash } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: { message: 'Invalid amount' } });

  const order = {
    id: uuidv4(),
    user_id: req.user.id,
    username: req.user.username,
    amount: parseFloat(amount),
    note: note || '',
    payment_method: payment_method || 'manual', // wechat, alipay, bnb
    tx_hash: tx_hash || '',
    status: 'pending',  // pending -> approved -> rejected
    admin_note: '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  addRechargeOrder(order);
  res.json({ success: true, data: order });
});

// Step 2: Verify BNB transaction on-chain (BscScan free API)
app.get('/api/payment/verify-bnb-tx', adminMiddleware, async (req, res) => {
  const { tx_hash, expected_amount, expected_address } = req.query;
  if (!tx_hash) return res.status(400).json({ error: { message: 'tx_hash required' } });

  const https = require('https');
  const url = `https://api.bscscan.com/api?module=proxy&action=eth_getTransactionByHash&txhash=${tx_hash}`;

  https.get(url, (r) => {
    let body = '';
    r.on('data', c => body += c);
    r.on('end', () => {
      try {
        const data = JSON.parse(body);
        if (data.error || !data.result || data.result === null) {
          return res.json({ success: false, message: 'Transaction not found on BSC' });
        }
        const tx = data.result;
        const to_address = '0x' + tx.to.toLowerCase().slice(-40);
        const value_bnb = parseInt(tx.value, 16) / 1e18;
        const cfg = getPaymentConfig();
        const cfg_address = (cfg.bnb_address || '').toLowerCase();

        res.json({
          success: true,
          data: {
            tx_hash,
            from: '0x' + tx.from.toLowerCase().slice(-40),
            to: to_address,
            value_bnb: value_bnb.toFixed(6),
            value_wei: tx.value,
            block_number: parseInt(tx.blockNumber, 16),
            matches_address: cfg_address ? to_address === cfg_address : null,
            expected_address: cfg_address || null,
          }
        });
      } catch (e) {
        res.json({ success: false, message: 'Failed to parse BscScan response' });
      }
    });
  }).on('error', (e) => {
    res.json({ success: false, message: 'BscScan request failed: ' + e.message });
  });
});

// Step 2.5: Verify BEP20 token transfer (USDT/USDC) on BSC
app.get('/api/payment/verify-bnb-token', adminMiddleware, async (req, res) => {
  const { tx_hash, token_contract } = req.query;
  // Default to USDT on BNB Chain: 0x55d3983263a0aa5e92bafb9e0caceb21d886618b3
  const contract = token_contract || '0x55d3983263a0aa5e92bafb9e0caceb21d886618b3';

  if (!tx_hash) return res.status(400).json({ error: { message: 'tx_hash required' } });

  const https = require('https');
  const url = `https://api.bscscan.com/api?module=account&action=tokentx&contractaddress=${contract}&txhash=${tx_hash}&page=1&offset=10`;

  https.get(url, (r) => {
    let body = '';
    r.on('data', c => body += c);
    r.on('end', () => {
      try {
        const data = JSON.parse(body);
        if (data.status !== '1' || !data.result || data.result.length === 0) {
          return res.json({ success: false, message: 'No token transfer found for this tx', raw: data });
        }
        const cfg = getPaymentConfig();
        const cfg_address = (cfg.bnb_address || '').toLowerCase();
        const transfers = data.result.map(t => ({
          from: t.from.toLowerCase(),
          to: t.to.toLowerCase(),
          value: (parseInt(t.value) / 1e18).toFixed(6),
          token_symbol: t.tokenSymbol,
          matches_address: cfg_address ? t.to.toLowerCase() === cfg_address : null,
        }));
        res.json({ success: true, data: { tx_hash, transfers, expected_address: cfg_address || null } });
      } catch (e) {
        res.json({ success: false, message: 'Failed to parse response', raw: body.substring(0, 500) });
      }
    });
  }).on('error', (e) => {
    res.json({ success: false, message: 'BscScan request failed: ' + e.message });
  });
});

// Step 3: User views their recharge orders
app.get('/api/recharge/orders', authMiddleware, (req, res) => {
  const orders = getRechargeOrders().filter(o => o.user_id === req.user.id).reverse();
  res.json({ success: true, data: orders });
});

// Step 3: Admin views all pending orders
app.get('/api/admin/recharge/orders', adminMiddleware, (req, res) => {
  const status = req.query.status || 'pending';
  const orders = getRechargeOrders().filter(o => status === 'all' || o.status === status).reverse();
  res.json({ success: true, data: orders });
});

// Step 4: Admin approves a recharge order
app.post('/api/admin/recharge/orders/:id/approve', adminMiddleware, (req, res) => {
  const order = getRechargeOrders().find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: { message: 'Order not found' } });
  if (order.status !== 'pending') return res.status(400).json({ error: { message: 'Order already processed' } });
  
  // Add balance to user
  const user = getUserById(order.user_id);
  if (user) {
    updateUser(user.id, {
      balance: Math.round((user.balance + order.amount) * 1000000) / 1000000,
    });
  }
  
  updateRechargeOrder(req.params.id, {
    status: 'approved',
    admin_note: req.body.note || '',
  });
  
  res.json({ success: true, message: `Approved! $${order.amount} added to user ${order.username}` });
});

// Step 5: Admin rejects a recharge order
app.post('/api/admin/recharge/orders/:id/reject', adminMiddleware, (req, res) => {
  const order = getRechargeOrders().find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: { message: 'Order not found' } });
  if (order.status !== 'pending') return res.status(400).json({ error: { message: 'Order already processed' } });
  
  updateRechargeOrder(req.params.id, {
    status: 'rejected',
    admin_note: req.body.note || '',
  });
  
  res.json({ success: true, message: 'Order rejected' });
});

// ============ Admin Routes ============
app.get('/api/admin/stats', adminMiddleware, (req, res) => {
  const orders = getRechargeOrders();
  const pendingOrders = orders.filter(o => o.status === 'pending').length;
  const approvedTotal = orders.filter(o => o.status === 'approved').reduce((s, o) => s + o.amount, 0);
  
  res.json({
    success: true,
    data: {
      userCount: getAllUsers().length,
      tokenCount: readJSON('tokens.json', []).length,
      totalUsage: Math.round(getTotalUsage() * 1000000) / 1000000,
      todayUsage: Math.round(getTodayUsage() * 1000000) / 1000000,
      todayRequests: getTodayRequests(),
      pendingOrders,
      approvedTotal: Math.round(approvedTotal * 1000000) / 1000000,
    }
  });
});

app.get('/api/admin/users', adminMiddleware, (req, res) => {
  res.json({ success: true, data: getAllUsers() });
});

app.put('/api/admin/users/:id', adminMiddleware, (req, res) => {
  updateUser(req.params.id, req.body);
  res.json({ success: true });
});

// ============ API Proxy (OpenAI-compatible) ============
app.get('/v1/models', apiKeyAuth, (req, res) => {
  const models = CONFIG.models.map(m => ({
    id: m.id, object: 'model', created: 1700000000, owned_by: m.provider.toLowerCase(),
  }));
  res.json({ object: 'list', data: models });
});

app.post('/v1/chat/completions', apiKeyAuth, async (req, res) => {
  const { model, messages, stream } = req.body;

  if (!CONFIG.upstream.apiKey) {
    return res.status(503).json({
      error: { message: 'Upstream API key not configured. Set UPSTREAM_API_KEY environment variable.' }
    });
  }

  const modelConfig = CONFIG.models.find(m => m.id === model);
  if (!modelConfig) {
    return res.status(400).json({ error: { message: `Model '${model}' not supported` } });
  }

  const multiplier = CONFIG.modelMultipliers[model] || CONFIG.defaultMultiplier;
  const inputPricePerToken = (modelConfig.input * multiplier) / 1000000;
  const outputPricePerToken = (modelConfig.output * multiplier) / 1000000;

  const https = require('https');
  const options = {
    hostname: 'api.quickrouter.ai',
    port: 443,
    path: '/v1/chat/completions',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${CONFIG.upstream.apiKey}`,
    },
  };

  const proxyReq = https.request(options, (proxyRes) => {
    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      proxyRes.pipe(res);
    } else {
      let body = '';
      proxyRes.on('data', chunk => body += chunk);
      proxyRes.on('end', () => {
        try {
          const data = JSON.parse(body);
          const inputTokens = data.usage?.prompt_tokens || 0;
          const outputTokens = data.usage?.completion_tokens || 0;
          const cost = (inputTokens * inputPricePerToken) + (outputTokens * outputPricePerToken);

          updateUser(req.user.id, {
            balance: Math.round((req.user.balance - cost) * 1000000) / 1000000,
            used_quota: Math.round((req.user.used_quota + cost) * 1000000) / 1000000,
          });
          updateToken(req.token.id, req.user.id, {
            used_quota: Math.round((req.token.used_quota + cost) * 1000000) / 1000000,
          });
          addUsageLog(req.user.id, req.token.id, model, inputTokens, outputTokens, cost);

          res.json(data);
        } catch (e) {
          res.status(502).json({ error: { message: 'Upstream returned invalid response', detail: body.substring(0, 500) } });
        }
      });
    }
  });

  proxyReq.on('error', (e) => {
    console.error('Upstream error:', e.message);
    res.status(502).json({ error: { message: 'Failed to connect to upstream', detail: e.message } });
  });

  const forwardBody = JSON.stringify({ ...req.body, stream: false });
  proxyReq.write(forwardBody);
  proxyReq.end();
});

// Health check
app.get('/api/health', (req, res) => {
  const orders = getRechargeOrders();
  res.json({
    success: true, status: 'ok',
    upstream_configured: !!CONFIG.upstream.apiKey,
    models_count: CONFIG.models.length,
    pending_orders: orders.filter(o => o.status === 'pending').length,
    timestamp: new Date().toISOString(),
  });
});

// SPA fallback
app.get('*', (req, res) => {
  if (req.path.startsWith('/v1/') || req.path.startsWith('/api/')) {
    return res.status(404).json({ error: { message: 'Not found' } });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============ Start ============
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n==============================================`);
  console.log(`  AI API Gateway running on port ${PORT}`);
  console.log(`  Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`  Upstream configured: ${!!CONFIG.upstream.apiKey}`);
  console.log(`==============================================\n`);
  initAdmin();
});
