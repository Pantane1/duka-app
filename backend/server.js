'use strict';

require('dotenv').config();

const express    = require('express');
const helmet     = require('helmet');
const cors       = require('cors');
const morgan     = require('morgan');
const rateLimit  = require('express-rate-limit');
const path       = require('path');

const { testConnection }         = require('./config/db');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const { sanitize }               = require('./middleware/sanitize');

// Routes
const productsRouter = require('./routes/products');
const cartRouter     = require('./routes/cart');
const checkoutRouter = require('./routes/checkout');
const paymentRouter  = require('./routes/payment');
const ordersRouter   = require('./routes/orders');

const app  = express();
const PORT = Number(process.env.PORT) || 3000;

/* ─── Security & Parsing middleware ─────────────────────── */
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? [process.env.FRONTEND_URL].filter(Boolean)
    : '*',
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
}));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(sanitize);

/* ─── Serve frontend ─────────────────────────────────────── */
const publicDir = path.join(__dirname, '..', 'frontend');
app.use(express.static(publicDir));

/* ─── Rate limiting ─────────────────────────────────────── */
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 200,
  standardHeaders: true, legacyHeaders: false,
  message: { success: false, error: 'Too many requests, please try again later.' },
});
const checkoutLimiter = rateLimit({
  windowMs: 60 * 1000, max: 5,
  message: { success: false, error: 'Too many checkout attempts. Please wait a moment.' },
});
app.use('/api', apiLimiter);

/* ─── API Routes ─────────────────────────────────────────── */
app.use('/api/products', productsRouter);
app.use('/api/cart',     cartRouter);
app.use('/api/checkout', checkoutLimiter, checkoutRouter);
app.use('/api/payment',  paymentRouter);
app.use('/api/orders',   ordersRouter);

// Lipana callback without /api prefix
app.post('/payment/callback', (req, res, next) => {
  req.url = '/callback';
  paymentRouter(req, res, next);
});

/* ─── Health check ───────────────────────────────────────── */
app.get('/health', (_req, res) =>
  res.json({ status: 'ok', ts: new Date().toISOString(), env: process.env.NODE_ENV })
);

/* ─── SPA fallback ───────────────────────────────────────── */
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/payment')) return next();
  res.sendFile(path.join(publicDir, 'index.html'));
});

/* ─── Error handlers ─────────────────────────────────────── */
app.use(notFound);
app.use(errorHandler);

/* ─── Boot ───────────────────────────────────────────────── */
async function start() {
  await testConnection();
  app.listen(PORT, () => {
    console.log(`\n🚀  Duka App → http://localhost:${PORT}`);
    console.log(`    Env          : ${process.env.NODE_ENV || 'development'}`);
    console.log(`    Callback URL : ${process.env.CALLBACK_URL || '⚠️  not set'}\n`);
  });
}

start().catch(err => { console.error('Fatal:', err); process.exit(1); });
module.exports = app;
