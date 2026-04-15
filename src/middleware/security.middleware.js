const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { env } = require('../config/env');

const corsMiddleware = cors({
  origin(origin, callback) {
    if (!origin || env.corsOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error('Origin is not allowed by CORS'));
  },
  credentials: true,
});

const helmetMiddleware = helmet({
  crossOriginResourcePolicy: false,
});

const authRateLimiter = rateLimit({
  windowMs: env.authRateLimitWindowMs,
  limit: env.authRateLimitMax,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many authentication attempts. Please try again later.',
  },
});

const apiRateLimiter = rateLimit({
  windowMs: env.apiRateLimitWindowMs,
  limit: env.apiRateLimitMax,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many API requests. Please try again later.',
  },
});

module.exports = { corsMiddleware, helmetMiddleware, authRateLimiter, apiRateLimiter };
