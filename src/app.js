const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
require('dotenv').config();

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Servir archivos subidos
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Servir archivos estáticos de descargas
app.use('/downloads', express.static(path.join(__dirname, '../public/downloads')));

// Swagger UI
const swaggerUi   = require('swagger-ui-express');
const swaggerSpec = require('./config/swagger');
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }',
  customSiteTitle: 'K-Dice POS API Docs',
  swaggerOptions: { persistAuthorization: true },
}));
app.get('/api/docs.json', (req, res) => res.json(swaggerSpec));

// Rutas
app.use('/api/auth',           require('./routes/auth.routes'));
app.use('/api/businesses',     require('./routes/business.routes'));
app.use('/api/business-types', require('./routes/businessType.routes'));

const checkBusinessStatus = require('./middleware/checkBusinessStatus');
app.use('/api/services',      checkBusinessStatus, require('./routes/service.routes'));
app.use('/api/employees',     checkBusinessStatus, require('./routes/employee.routes'));
app.use('/api/appointments',  checkBusinessStatus, require('./routes/appointment.routes'));
app.use('/api/schedules',     checkBusinessStatus, require('./routes/schedule.routes'));
app.use('/api/upload',        require('./routes/upload.routes'));
app.use('/api/notifications', require('./routes/notification.routes'));
app.use('/api/apk',           require('./routes/apk.routes'));

app.get('/api/health', (req, res) => res.json({ status: 'ok', version: '3.0.0', timestamp: new Date() }));

// Servir frontend en produccion
const frontendDist = path.join(__dirname, '../../frontend/dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get('*', (req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

module.exports = app;
