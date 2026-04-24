require('dotenv').config();
const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const helmet     = require('helmet');
const cors       = require('cors');
const morgan     = require('morgan');
const rateLimit  = require('express-rate-limit');
const path       = require('path');
const fs         = require('fs');

const logger = require('./config/logger');
const { pool } = require('./config/database');

const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const {
  buildingsRouter,
  scansRouter,
  reportsRouter,
  marketplaceRouter,
  notificationsRouter,
  adminRouter,
} = require('./routes/index');

// ── Ensure logs dir exists
const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

// ── Ensure models dir exists
const modelsDir = path.join(__dirname, '../models');
if (!fs.existsSync(modelsDir)) fs.mkdirSync(modelsDir, { recursive: true });

const app    = express();
const server = http.createServer(app);

// ── Socket.IO
const io = new Server(server, {
  cors: { origin: process.env.FRONTEND_URL || '*', methods: ['GET', 'POST'] },
});

global.io = io;

io.on('connection', (socket) => {
  socket.on('join', (userId) => {
    socket.join(`user:${userId}`);
    logger.info(`Socket joined room user:${userId}`);
  });
  socket.on('disconnect', () => {});
});

// ── Security middleware
app.use(helmet());
app.use(cors({
  origin:      process.env.FRONTEND_URL || '*',
  credentials: true,
  methods:     ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ── Rate limiting
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later.' },
});
app.use(globalLimiter);

// ── Body parsing
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ── Logging
app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));

// ── Health check
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({
      success: true,
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: '1.0.0',
    });
  } catch (err) {
    res.status(503).json({ success: false, status: 'unhealthy', error: err.message });
  }
});

// ── API Routes
const API = '/api/v1';
app.use(`${API}/auth`,          authRoutes);
app.use(`${API}/users`,         userRoutes);
app.use(`${API}/buildings`,     buildingsRouter);
app.use(`${API}/scans`,         scansRouter);
app.use(`${API}/reports`,       reportsRouter);
app.use(`${API}/marketplace`,   marketplaceRouter);
app.use(`${API}/notifications`, notificationsRouter);
app.use(`${API}/admin`,         adminRouter);

// ── 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.method} ${req.path} not found` });
});

// ── Global error handler
app.use((err, req, res, next) => {
  logger.error(`Unhandled error: ${err.message}`, err);

  if (err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE')
      return res.status(400).json({ success: false, message: 'File too large. Maximum size is 10MB.' });
    return res.status(400).json({ success: false, message: err.message });
  }

  const statusCode = err.status || err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    message: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
  });
});

// ── Start scan queue processor
require('./services/scan.processor');

// ── Boot server
const PORT = process.env.PORT || 6000;
server.listen(PORT, async () => {
  logger.info(`🚀 CrackDetectX API running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
  try {
    await pool.query('SELECT 1');
    logger.info('✅ PostgreSQL connected');
  } catch (err) {
    logger.error(`❌ PostgreSQL connection failed: ${err.message}`);
  }

  // Warm up ONNX model
  try {
    const { loadModel } = require('./services/ai.service');
    await loadModel();
  } catch (err) {
    logger.warn(`⚠️  ONNX model warm-up skipped: ${err.message}`);
  }
});

// ── Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received — shutting down...');
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
});

process.on('unhandledRejection', (reason) => logger.error(`Unhandled Rejection: ${reason}`));
process.on('uncaughtException',  (err)    => { logger.error(`Uncaught Exception: ${err.message}`); process.exit(1); });

module.exports = { app, server };