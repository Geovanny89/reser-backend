const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();

// 1. Cabeceras de seguridad
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" } // Permite cargar recursos cruzados (imágenes/pdfs) en el frontend
}));

// 2. Configuración CORS estricta
const allowedOrigins = [
  'https://reservas.k-dice.com',
  'https://api-reservas.k-dice.com',
  'https://kdice.app',
  'http://localhost',
  'http://localhost:5173',
  'http://localhost:3000',
  'capacitor://localhost',
  'ionic://localhost',
  'file://',
  process.env.FRONTEND_URL
].filter(Boolean);

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || origin === 'null' || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.error('[CORS ERROR] Origen bloqueado:', origin);
      callback(new Error('No permitido por CORS'));
    }
  },
  credentials: true
}));

// 3. Rate Limiting (Aplica a las rutas de la API, excepto webhooks de Evolution)
app.set('trust proxy', 1); 
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 500, 
  skip: (req) => req.path.includes('/evolution/webhook'), // Skip rate limit for webhooks
  message: { error: 'Demasiadas peticiones desde esta IP, por favor intenta de nuevo después de 15 minutos.' }
});
app.use('/api/', limiter);

// 4. Límites de Payload (ajustado a 10mb para excel e imágenes)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rutas críticas primero para probar
app.post('/api/test-post', (req, res) => res.json({ ok: true }));
app.use('/api/promotions', require('./routes/promotion.routes'));

// Servir archivos subidos
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Servir archivos estáticos de descargas
app.use('/downloads', express.static(path.join(__dirname, '../public/downloads')));

// Servir la APK desde la carpeta estática del frontend (fuera de public para evitar peso extra)
app.use('/apk', express.static(path.join(__dirname, '../../frontend/public-static/apk')));

// Swagger UI
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./config/swagger');
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }',
  customSiteTitle: 'K-Dice POS API Docs',
  swaggerOptions: { persistAuthorization: true },
}));
app.get('/api/docs.json', (req, res) => res.json(swaggerSpec));

// Rutas
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/businesses', require('./routes/business.routes'));
app.use('/api/business-types', require('./routes/businessType.routes'));

const checkBusinessStatus = require('./middleware/checkBusinessStatus');
app.use('/api/services', checkBusinessStatus, require('./routes/service.routes'));
app.use('/api/service-groups', checkBusinessStatus, require('./routes/serviceGroup.routes'));
app.use('/api/employees', checkBusinessStatus, require('./routes/employee.routes'));
app.use('/api/appointments', checkBusinessStatus, require('./routes/appointment.routes'));
app.use('/api/schedules', checkBusinessStatus, require('./routes/schedule.routes'));
app.use('/api/special-schedules', checkBusinessStatus, require('./routes/specialSchedule.routes'));
app.use('/api/employee-vacations', checkBusinessStatus, require('./routes/employeeVacation.routes'));
app.use('/api/upload', require('./routes/upload.routes'));
app.use('/api/notifications', require('./routes/notification.routes'));
app.use('/api/system-settings', require('./routes/systemSetting.routes'));
app.use('/api/superadmin', require('./routes/superAdmin.routes'));
app.use('/api/platform-reviews', require('./routes/platformReview.routes'));

// Módulos opcionales configurables
app.use('/api/expenses', checkBusinessStatus, require('./routes/expense.routes'));
app.use('/api/inventory', checkBusinessStatus, require('./routes/inventory.routes'));
app.use('/api/deposits', checkBusinessStatus, require('./routes/deposit.routes'));
app.use('/api/cash-register', checkBusinessStatus, require('./routes/cashRegister.routes'));

// Informe financiero integrado
app.use('/api/financial-report', checkBusinessStatus, require('./routes/financialReport.routes'));

// Socket.io management endpoints
app.use('/api/socket', require('./routes/socket.routes'));

app.get('/api/health', (req, res) => {
  const mem = process.memoryUsage();
  const cacheService = require('./services/cacheService');
  const { getInstanceCount } = require('./services/evolution/state');
  res.json({
    status: 'ok',
    version: '3.0.0',
    timestamp: new Date(),
    memory: {
      rssMB: (mem.rss / 1024 / 1024).toFixed(2),
      heapUsedMB: (mem.heapUsed / 1024 / 1024).toFixed(2),
      heapTotalMB: (mem.heapTotal / 1024 / 1024).toFixed(2),
      externalMB: (mem.external / 1024 / 1024).toFixed(2),
      heapUsagePct: mem.heapTotal > 0 ? ((mem.heapUsed / mem.heapTotal) * 100).toFixed(2) + '%' : 'N/A'
    },
    cache: cacheService.getStats(),
    evolutionInstances: getInstanceCount()
  });
});

// Servir frontend en produccion
const frontendDist = path.join(__dirname, '../../frontend/dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get('*', (req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

module.exports = app;
