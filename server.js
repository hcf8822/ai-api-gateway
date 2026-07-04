require('dotenv').config();
const express = require('express');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

// ============ Config ============
const CONFIG = {
  // QuickRouter upstream
  upstream: {
    baseUrl: 'https://api.quickrouter.ai',
    apiKey: process.env.UPSTREAM_API_KEY || '',
  },
  // Pricing multipliers (your price = upstream price * multiplier)
  // Set higher than 1.0 to make profit
  defaultMultiplier: 1.2,
  modelMultipliers: {
    'gpt-4o': 1.2,
    'gpt-4o-mini': 1.2,
    'gpt-4-turbo': 1.2,
    'gpt-3.5-turbo': 1.2,
    'claude-sonnet-4-20250514': 1.25,
    'claude-3-5-sonnet-20241022': 1.25,
    'claude-3-opus-20240229': 1.25,
    'claude-3-haiku-20240307': 1.25,
    'gemini-2.0-flash': 1.3,
    'gemini-1.5-pro': 1.3,
    'gemini-1.5-flash': 1.3,
    'deepseek-chat': 1.3,
    'deepseek-coder': 1.3,
    'grok-2': 1.2,
    'grok-beta': 1.2,
  },
  // Free credits for new users (in USD)
  signupBonus: 1.0,
  // Supported models
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

// ============ Database ============
const db = new Database(path.join(__dirname, 'data', 'gateway.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'user',
    balance REAL DEFAULT 0,
    used_quota REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    status TEXT DEFAULT 'active'
  );

  CREATE TABLE IF NOT EXISTS tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT DEFAULT 'default',
    key TEXT UNIQUE NOT NULL,
    quota_limit REAL DEFAULT 0,
    used_quota REAL DEFAULT 0,
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS usage_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    token_id TEXT,
    model TEXT NOT NULL,
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    cost REAL DEFAULT 0,
    status TEXT DEFAULT 'success',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS recharge_orders (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    amount REAL NOT NULL,
    method TEXT DEFAULT 'manual',
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// Ensure data dir exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// ============ Middleware ============
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/v1', express.static(path.join(__dirname, 'public')));

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Request logging
app.use((req, res, next) => {
  if (!req.path.startsWith('/v1/')) {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  }
  next();
});

// Auth middleware
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.token;
  if (!token) {
    return res.status(401).json({ error: { message: 'Unauthorized' } });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(decoded.userId);
    if (!user || user.status !== 'active') {
      return res.status(401).json({ error: { message: 'Unauthorized' } });
    }
    req.user = user;
    next();
  } catch (e) {
    return res.status(401).json({ error: { message: 'Invalid token' } });
  }
}

function adminMiddleware(req, res, next) {
  authMiddleware(req, res, () => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: { message: 'Forbidden' } });
    }
    next();
  });
}

// API key auth (for /v1 endpoints)
function apiKeyAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: { message: 'Missing API key. Set Authorization: Bearer sk-xxx' } });
  }
  const apiKey = authHeader.replace('Bearer ', '');
  const token = db.prepare('SELECT * FROM tokens WHERE key = ? AND status = ?').get(apiKey, 'active');
  if (!token) {
    return res.status(401).json({ error: { message: 'Invalid API key' } });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND status = ?').get(token.user_id, 'active');
  if (!user) {
    return res.status(401).json({ error: { message: 'User inactive' } });
  }
  if (user.balance <= 0 && token.quota_limit > 0 && token.used_quota >= token.quota_limit) {
    return res.status(402).json({ error: { message: 'Insufficient balance' } });
  }
  if (user.balance <= 0) {
    return res.status(402).json({ error: { message: 'Insufficient balance. Please recharge.' } });
  }
  req.token = token;
  req.user = user;
  next();
}

// ============ Auth Routes ============
app.post('/api/auth/register', (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) {
    return res.status(400).json({ error: { message: 'All fields required' } });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: { message: 'Password must be at least 6 characters' } });
  }
  const existing = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(username, email);
  if (existing) {
    return res.status(409).json({ error: { message: 'Username or email already exists' } });
  }
  const userId = uuidv4();
  const hashedPassword = bcrypt.hashSync(password, 10);
  db.prepare('INSERT INTO users (id, username, email, password, balance) VALUES (?, ?, ?, ?, ?)')
    .run(userId, username, email, hashedPassword, CONFIG.signupBonus);
  const token = jwt.sign({ userId }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ success: true, token, user: { id: userId, username, email, balance: CONFIG.signupBonus } });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: { message: 'Username and password required' } });
  }
  const user = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(username, username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: { message: 'Invalid credentials' } });
  }
  if (user.status !== 'active') {
    return res.status(403).json({ error: { message: 'Account suspended' } });
  }
  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
  res.json({
    success: true,
    token,
    user: { id: user.id, username: user.username, email: user.email, balance: user.balance, role: user.role }
  });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({
    success: true,
    user: {
      id: req.user.id,
      username: req.user.username,
      email: req.user.email,
      balance: req.user.balance,
      used_quota: req.user.used_quota,
      role: req.user.role,
      created_at: req.user.created_at,
    }
  });
});

// ============ Token Management ============
app.get('/api/tokens', authMiddleware, (req, res) => {
  const tokens = db.prepare('SELECT id, name, key, quota_limit, used_quota, status, created_at FROM tokens WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
  res.json({ success: true, data: tokens });
});

app.post('/api/tokens', authMiddleware, (req, res) => {
  const { name, quota_limit } = req.body;
  const tokenId = uuidv4();
  const apiKey = 'sk-' + crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO tokens (id, user_id, name, key, quota_limit) VALUES (?, ?, ?, ?, ?)')
    .run(tokenId, req.user.id, name || 'default', apiKey, quota_limit || 0);
  res.json({ success: true, data: { id: tokenId, key: apiKey, name: name || 'default', quota_limit: quota_limit || 0 } });
});

app.delete('/api/tokens/:id', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM tokens WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ success: true });
});

app.put('/api/tokens/:id', authMiddleware, (req, res) => {
  const { name, status, quota_limit } = req.body;
  db.prepare('UPDATE tokens SET name = COALESCE(?, name), status = COALESCE(?, status), quota_limit = COALESCE(?, quota_limit) WHERE id = ? AND user_id = ?')
    .run(name, status, quota_limit, req.params.id, req.user.id);
  res.json({ success: true });
});

// ============ Usage Stats ============
app.get('/api/usage', authMiddleware, (req, res) => {
  const days = parseInt(req.query.days) || 7;
  const logs = db.prepare(`
    SELECT date(created_at) as date, model,
           SUM(input_tokens) as input_tokens, SUM(output_tokens) as output_tokens,
           SUM(cost) as cost, COUNT(*) as count
    FROM usage_logs
    WHERE user_id = ? AND created_at >= datetime('now', ?)
    GROUP BY date(created_at), model
    ORDER BY date DESC
  `).all(req.user.id, `-${days} days`);
  res.json({ success: true, data: logs });
});

app.get('/api/usage/recent', authMiddleware, (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const logs = db.prepare('SELECT * FROM usage_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?').all(req.user.id, limit);
  res.json({ success: true, data: logs });
});

// ============ Models ============
app.get('/api/models', (req, res) => {
  const models = CONFIG.models.map(m => {
    const multiplier = CONFIG.modelMultipliers[m.id] || CONFIG.defaultMultiplier;
    return {
      ...m,
      input_price: (m.input * multiplier).toFixed(4),
      output_price: (m.output * multiplier).toFixed(4),
      multiplier,
    };
  });
  res.json({ success: true, data: models });
});

// ============ Recharge ============
app.post('/api/recharge', authMiddleware, (req, res) => {
  const { amount } = req.body;
  if (!amount || amount <= 0) {
    return res.status(400).json({ error: { message: 'Invalid amount' } });
  }
  // Manual recharge - in production this would integrate with payment gateway
  db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(amount, req.user.id);
  const orderId = uuidv4();
  db.prepare('INSERT INTO recharge_orders (id, user_id, amount, status) VALUES (?, ?, ?, ?)')
    .run(orderId, req.user.id, amount, 'completed');
  res.json({ success: true, message: 'Recharge successful', new_balance: req.user.balance + amount });
});

// ============ Admin Routes ============
app.get('/api/admin/stats', adminMiddleware, (req, res) => {
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  const tokenCount = db.prepare('SELECT COUNT(*) as count FROM tokens').get().count;
  const totalUsage = db.prepare('SELECT SUM(cost) as total FROM usage_logs').get().total || 0;
  const todayUsage = db.prepare("SELECT SUM(cost) as total FROM usage_logs WHERE date(created_at) = date('now')").get().total || 0;
  const todayRequests = db.prepare("SELECT COUNT(*) as count FROM usage_logs WHERE date(created_at) = date('now')").get().count;
  res.json({
    success: true,
    data: { userCount, tokenCount, totalUsage, todayUsage, todayRequests }
  });
});

app.get('/api/admin/users', adminMiddleware, (req, res) => {
  const users = db.prepare('SELECT id, username, email, role, balance, used_quota, status, created_at FROM users ORDER BY created_at DESC').all();
  res.json({ success: true, data: users });
});

app.put('/api/admin/users/:id', adminMiddleware, (req, res) => {
  const { status, balance, role } = req.body;
  db.prepare('UPDATE users SET status = COALESCE(?, status), balance = COALESCE(?, balance), role = COALESCE(?, role) WHERE id = ?')
    .run(status, balance, role, req.params.id);
  res.json({ success: true });
});

// ============ API Proxy (OpenAI-compatible) ============
app.get('/v1/models', apiKeyAuth, (req, res) => {
  const models = CONFIG.models.map(m => ({
    id: m.id,
    object: 'model',
    created: 1700000000,
    owned_by: m.provider.toLowerCase(),
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

  // Forward to upstream
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

  const https = require('https');
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
          // Calculate cost
          const inputTokens = data.usage?.prompt_tokens || 0;
          const outputTokens = data.usage?.completion_tokens || 0;
          const cost = (inputTokens * inputPricePerToken) + (outputTokens * outputPricePerToken);

          // Deduct balance
          db.prepare('UPDATE users SET balance = balance - ?, used_quota = used_quota + ? WHERE id = ?')
            .run(cost, cost, req.user.id);
          db.prepare('UPDATE tokens SET used_quota = used_quota + ? WHERE id = ?')
            .run(cost, req.token.id);
          // Log usage
          db.prepare('INSERT INTO usage_logs (user_id, token_id, model, input_tokens, output_tokens, cost) VALUES (?, ?, ?, ?, ?, ?)')
            .run(req.user.id, req.token.id, model, inputTokens, outputTokens, cost);

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

  // Forward the request body
  const forwardBody = JSON.stringify({ ...req.body, stream: false });
  proxyReq.write(forwardBody);
  proxyReq.end();
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    status: 'ok',
    upstream_configured: !!CONFIG.upstream.apiKey,
    models_count: CONFIG.models.length,
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

// ============ Init: create admin user ============
function initAdmin() {
  const adminExists = db.prepare("SELECT id FROM users WHERE role = 'admin'").get();
  if (!adminExists) {
    const adminId = uuidv4();
    const hashedPassword = bcrypt.hashSync('admin123', 10);
    db.prepare("INSERT INTO users (id, username, email, password, role, balance) VALUES (?, ?, ?, ?, 'admin', 1000)")
      .run(adminId, 'admin', 'admin@localhost', hashedPassword);
    console.log('\n============================================');
    console.log('  Admin account created:');
    console.log('  Username: admin');
    console.log('  Password: admin123');
    console.log('  Balance:  $1000 (for testing)');
    console.log('============================================\n');
  }
}

// ============ Start ============
app.listen(PORT, '0.0.0.0', () => {
  console.log('\n============================================');
  console.log(`  AI API Gateway running on port ${PORT}`);
  console.log(`  Landing page:  http://localhost:${PORT}`);
  console.log(`  Admin login:    http://localhost:${PORT}/login.html`);
  console.log(`  API endpoint:   http://localhost:${PORT}/v1`);
  console.log('============================================\n');
  initAdmin();
});
