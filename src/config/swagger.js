const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'K-Dice POS API',
      version: '3.0.0',
      description: `
## K-Dice POS — Sistema de Gestión de Citas y Negocios

API REST completa para el sistema K-Dice POS. Permite gestionar negocios, servicios, empleados, citas, horarios y la personalización de páginas públicas.

### Autenticación
La mayoría de los endpoints requieren un token JWT. Para obtenerlo, usa el endpoint \`POST /api/auth/login\` e incluye el token en el header:
\`\`\`
Authorization: Bearer <token>
\`\`\`

### Roles
- **superadmin**: Acceso total al sistema
- **admin**: Gestión de su propio negocio
- **employee**: Visualización de sus citas
- **client**: Reserva de citas
      `,
      contact: {
        name: 'K-Dice POS Support',
        email: 'soporte@kdice.com',
      },
      license: {
        name: 'MIT',
      },
    },
    servers: [
      { url: '/api', description: 'API Principal' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Token JWT obtenido al iniciar sesión',
        },
      },
      schemas: {
        Business: {
          type: 'object',
          properties: {
            id:              { type: 'string', format: 'uuid' },
            name:            { type: 'string', example: 'Barbería El Estilo' },
            slug:            { type: 'string', example: 'barberia-el-estilo' },
            type:            { type: 'string', example: 'barberia' },
            description:     { type: 'string' },
            phone:           { type: 'string', example: '+57 300 123 4567' },
            address:         { type: 'string', example: 'Calle 10 #5-30, Bogotá' },
            logoUrl:         { type: 'string', example: '/uploads/logo.jpg' },
            bannerUrl:       { type: 'string', example: '/uploads/banner.jpg' },
            whatsapp:        { type: 'string', example: '+57 300 123 4567' },
            instagram:       { type: 'string', example: '@barberia_estilo' },
            facebook:        { type: 'string', example: 'facebook.com/barberiaestilo' },
            tiktok:          { type: 'string', example: '@barberiaestilo' },
            twitter:         { type: 'string', example: '@barberiaestilo' },
            website:         { type: 'string', example: 'https://barberiaestilo.com' },
            gallery:         { type: 'string', example: '[]', description: 'JSON array de URLs de imágenes' },
            primaryColor:    { type: 'string', example: '#667eea' },
            secondaryColor:  { type: 'string', example: '#764ba2' },
            tagline:         { type: 'string', example: 'Tu estilo, nuestra pasión' },
            ctaText:         { type: 'string', example: 'Reservar cita ahora' },
            businessHours:   { type: 'string', example: 'Lun-Sáb 9am-7pm' },
            status:          { type: 'string', enum: ['active', 'blocked'] },
            subscriptionStatus: { type: 'string', enum: ['pending', 'paid', 'overdue'] },
          },
        },
        BusinessType: {
          type: 'object',
          properties: {
            id:     { type: 'string', format: 'uuid' },
            value:  { type: 'string', example: 'barberia' },
            label:  { type: 'string', example: 'Barbería' },
            icon:   { type: 'string', example: '✂️' },
            active: { type: 'boolean' },
            order:  { type: 'integer' },
          },
        },
        Service: {
          type: 'object',
          properties: {
            id:          { type: 'string', format: 'uuid' },
            name:        { type: 'string', example: 'Corte de cabello' },
            description: { type: 'string' },
            price:       { type: 'number', example: 25000 },
            durationMin: { type: 'integer', example: 30 },
            active:      { type: 'boolean' },
          },
        },
        Employee: {
          type: 'object',
          properties: {
            id:         { type: 'string', format: 'uuid' },
            businessId: { type: 'string', format: 'uuid' },
            userId:     { type: 'string', format: 'uuid' },
            active:     { type: 'boolean' },
          },
        },
        Appointment: {
          type: 'object',
          properties: {
            id:         { type: 'string', format: 'uuid' },
            startTime:  { type: 'string', format: 'date-time' },
            endTime:    { type: 'string', format: 'date-time' },
            status:     { type: 'string', enum: ['pending', 'confirmed', 'cancelled', 'completed'] },
            notes:      { type: 'string' },
          },
        },
        User: {
          type: 'object',
          properties: {
            id:    { type: 'string', format: 'uuid' },
            name:  { type: 'string', example: 'Juan Pérez' },
            email: { type: 'string', format: 'email' },
            role:  { type: 'string', enum: ['superadmin', 'admin', 'employee', 'client'] },
          },
        },
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string', example: 'Mensaje de error descriptivo' },
          },
        },
      },
    },
    tags: [
      { name: 'Auth',          description: 'Autenticación y registro de usuarios' },
      { name: 'Businesses',    description: 'Gestión de negocios' },
      { name: 'BusinessTypes', description: 'Tipos de negocio (CRUD superadmin)' },
      { name: 'Services',      description: 'Servicios ofrecidos por el negocio' },
      { name: 'Employees',     description: 'Gestión de empleados' },
      { name: 'Appointments',  description: 'Reservas y citas' },
      { name: 'Schedules',     description: 'Horarios de empleados' },
      { name: 'Upload',        description: 'Subida de archivos e imágenes' },
      { name: 'Notifications', description: 'Sistema de notificaciones' },
    ],
  },
  apis: [
    './src/routes/*.js',
    './src/controllers/*.js',
  ],
};

module.exports = swaggerJsdoc(options);
