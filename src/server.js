require('dotenv').config();
const app = require('./app');
const { sequelize, BusinessType, User, Business } = require('./models');
const bcrypt = require('bcryptjs');
const { startReminderService } = require('./services/reminderService');
const { startPendingAlertService } = require('./services/pendingAlertService');
const { initWhatsAppManager } = require('./services/whatsappService');
const { Op } = require('sequelize');
const PORT = process.env.PORT || 4000;

const DEFAULT_TYPES = [
  { value: 'barberia',    label: 'Barbería',          icon: '✂️',  order: 1 },
  { value: 'spa',         label: 'Spa',               icon: '💆',  order: 2 },
  { value: 'unas',        label: 'Uñas',              icon: '💅',  order: 3 },
  { value: 'salon',       label: 'Salón de Belleza',  icon: '💇',  order: 4 },
  { value: 'peluqueria',  label: 'Peluquería',        icon: '💈',  order: 5 },
  { value: 'masajes',     label: 'Masajes',           icon: '🧖',  order: 6 },
  { value: 'tatuajes',    label: 'Tatuajes',          icon: '🎨',  order: 7 },
  { value: 'estetica',    label: 'Estética',          icon: '✨',  order: 8 },
  { value: 'veterinaria', label: 'Veterinaria',       icon: '🐾',  order: 9 },
  { value: 'otro',        label: 'Otro',              icon: '🏪',  order: 99 },
];

async function seedBusinessTypes() {
  for (const t of DEFAULT_TYPES) {
    const exists = await BusinessType.findOne({ where: { value: t.value } });
    if (!exists) await BusinessType.create(t);
  }
  console.log('✅  Tipos de negocio verificados/creados');
}

async function seedSuperAdmin() {
  const email = 'admin@admin.com';
  const exists = await User.findOne({ where: { email } });
  if (!exists) {
    const hash = await bcrypt.hash('Jose2021*', 10);
    await User.create({
      name: 'Super Admin',
      email,
      password: hash,
      role: 'superadmin',
      status: 'active'
    });
    console.log('✅  Usuario SuperAdmin creado (admin@admin.com)');
  } else {
    // Solo asegurar que sea superadmin y esté activo, NO resetear contraseña
    await exists.update({ 
      role: 'superadmin',
      status: 'active'
    });
    console.log('✅  Usuario SuperAdmin verificado (contraseña preservada)');
  }
}

/**
 * Tarea programada para verificar vencimientos de suscripción (cada 24 horas)
 */
function startSubscriptionCheck() {
  console.log('🛡️  Iniciando monitor de suscripciones automáticas');
  
  // Ejecutar inmediatamente al iniciar
  checkExpiringSubscriptions();
  
  // Y luego cada 24 horas
  setInterval(checkExpiringSubscriptions, 24 * 60 * 60 * 1000);
}

async function checkExpiringSubscriptions() {
  try {
    const now = new Date();
    
    // Buscar negocios cuya suscripción haya vencido y no estén bloqueados aún
    const expired = await Business.findAll({
      where: {
        subscriptionEndDate: { [Op.lt]: now },
        status: 'active'
      }
    });

    for (const biz of expired) {
      console.log(`🚫 Bloqueando negocio vencido: ${biz.name} (Venció: ${biz.subscriptionEndDate})`);
      await biz.update({ 
        status: 'blocked',
        subscriptionStatus: 'overdue'
      });
    }

    if (expired.length > 0) {
      console.log(`✅ Se bloquearon ${expired.length} negocios por falta de pago.`);
    }
  } catch (err) {
    console.error('❌ Error en el chequeo de suscripciones:', err);
  }
}

async function start() {
  try {
    await sequelize.authenticate();
    console.log('✅  Conexión a base de datos establecida');
    
    try {
      await sequelize.sync({ alter: false });
      console.log('✅  Modelos sincronizados con la base de datos (alter: true)');
    } catch (syncErr) {
      console.error('⚠️  Error al sincronizar modelos (puede ser normal en PostgreSQL con ENUMs):', syncErr.message);
      console.log('💡 Intenta ejecutar las migraciones manuales si es necesario.');
    }

    await seedBusinessTypes();
    await seedSuperAdmin();
    
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀  Backend corriendo en http://0.0.0.0:${PORT}`);
      console.log(`📚  Documentación Swagger: http://tu-ip-vps:${PORT}/api/docs`);
      // Iniciar servicio de recordatorios automáticos (1 hora antes de cada cita)
      startReminderService();
      console.log('⏰  Servicio de recordatorios automáticos iniciado');
      
      // Iniciar monitor de suscripciones
      startSubscriptionCheck();
      
      // Iniciar servicio de alertas para citas pendientes no atendidas
      startPendingAlertService();
      console.log('🔔 Servicio de alertas de citas pendientes iniciado');
      
      // Iniciar instancias de WhatsApp
      initWhatsAppManager();
    });
  } catch (err) {
    console.error('❌  Error al iniciar:', err);
    process.exit(1);
  }
}
start();
