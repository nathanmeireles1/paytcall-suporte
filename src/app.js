require('dotenv').config();
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

const app = express();

// Necessário para Railway/proxies reversos (rate limit e IPs corretos)
app.set('trust proxy', 1);

// Views
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Static
app.use(express.static(path.join(__dirname, '../public')));

// Cookie parser
app.use(cookieParser());

// CORS — permite requisições da payt.com.br e paytcall.com.br
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Body parsing
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// Rate limiting para webhook
const webhookLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 60,
  message: { error: 'Too many requests' },
});

// Rate limiting para API
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 30,
  message: { error: 'Too many requests' },
});

// Auth middleware
const { requireAuth } = require('./middleware/auth');

// Rotas públicas (login, convite) — sem auth
app.use('/', require('./routes/auth'));

// Webhook — sem auth (chamado pela Payt)
app.use('/webhook', webhookLimiter, require('./routes/webhook'));

// API tracking — protegido por cookie auth
app.use('/api/tracking', apiLimiter, requireAuth, require('./routes/tracking'));

// Rotas protegidas — auth via cookie
app.use('/admin', require('./routes/admin'));
app.use('/relatorios', requireAuth, require('./routes/relatorios'));
app.use('/', requireAuth, require('./routes/ai'));
app.use('/', requireAuth, require('./routes/dashboard'));

// 404
app.use((req, res) => {
  res.status(404).render('error', { message: 'Página não encontrada' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  if (req.path.startsWith('/api') || req.path.startsWith('/webhook')) {
    return res.status(500).json({ error: 'Erro interno' });
  }
  res.status(500).render('error', { message: 'Erro interno do servidor' });
});

module.exports = app;
