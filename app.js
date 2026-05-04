const express = require('express');
const path = require('path');
const { env } = require('./src/config/env');
const { errorHandler, notFoundHandler } = require('./src/middleware/error.middleware');
const { corsMiddleware, helmetMiddleware, authRateLimiter, apiRateLimiter } = require('./src/middleware/security.middleware');
const { authRouter } = require('./src/modules/auth/auth.routes');
const { dashboardRouter } = require('./src/modules/dashboard/dashboard.routes');
const { resourceRouter } = require('./src/modules/resource/resource.routes');
const { importRouter } = require('./src/modules/import/import.routes');
const { validationRouter } = require('./src/modules/validation/validation.routes');

const app = express();
app.set('trust proxy', 1);

app.use(helmetMiddleware);
app.use(corsMiddleware);
app.use(express.json({ limit: env.apiBodyLimit }));
app.use(express.urlencoded({ extended: true }));
app.use(apiRateLimiter);

if (env.serveTestUi) {
  app.use(express.static(path.join(__dirname, 'public')));
}

app.get('/', (_req, res) => {
  if (env.serveTestUi) {
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }

  return res.json({
    success: true,
    service: 'syntrix-backend',
    message: 'Backend API is running. Use /health and /api/v1/* endpoints.',
  });
});

app.get('/health', (_req, res) => {
  res.json({
    success: true,
    service: 'syntrix-backend',
    environment: env.nodeEnv,
    timestamp: new Date().toISOString(),
  });
});

app.use('/api/v1/auth', authRateLimiter, authRouter);
app.use('/api/v1/dashboard', dashboardRouter);
app.use('/api/v1/imports', importRouter);
app.use('/api/v1/validation-requests', validationRouter);
app.use('/api/v1', resourceRouter);

app.use(notFoundHandler);
app.use(errorHandler);

if (process.env.VERCEL !== '1') {
  app.listen(env.port, () => {
    // Keep startup logs concise for container deployments.
    console.log(`Syntrix backend listening on port ${env.port}`);
  });
}

module.exports = app;
