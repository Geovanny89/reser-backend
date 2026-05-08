require('dotenv').config();

// ─── Silenciar console.log en producción ───────────────────────────────────
// Se conservan console.warn y console.error para detectar problemas reales.
if (process.env.NODE_ENV === 'production') {
  console.log = () => { };
}
// ──────────────────────────────────────────────────────────────────────────

const http = require('http');
const app = require('./app');
const { sequelize, BusinessType, User, Business } = require('./models');
const bcrypt = require('bcryptjs');
const { startReminderService } = require('./services/reminderService');
const { startPendingAlertService } = require('./services/pendingAlertService');
const { initWhatsAppManager } = require('./services/evolutionService');
const { runScheduler, isBusinessHours, cleanupOldMessages } = require('./services/schedulerService');
const cacheService = require('./services/cacheService');
const { initializeSocketServer } = require('./services/socketService');
const { Op } = require('sequelize');
const PORT = process.env.PORT || 4000;
const DISABLE_BACKGROUND_JOBS = process.env.DISABLE_BACKGROUND_JOBS === 'true';

const DEFAULT_TYPES = [
  { value: 'barberia', label: 'Barbería', icon: '✂️', order: 1 },
  { value: 'spa', label: 'Spa', icon: '💆', order: 2 },
  { value: 'unas', label: 'Uñas', icon: '💅', order: 3 },
  { value: 'salon', label: 'Salón de Belleza', icon: '💇', order: 4 },
  { value: 'peluqueria', label: 'Peluquería', icon: '💈', order: 5 },
  { value: 'masajes', label: 'Masajes', icon: '🧖', order: 6 },
  { value: 'tatuajes', label: 'Tatuajes', icon: '🎨', order: 7 },
  { value: 'estetica', label: 'Estética', icon: '✨', order: 8 },
  { value: 'veterinaria', label: 'Veterinaria', icon: '🐾', order: 9 },
  { value: 'otro', label: 'Otro', icon: '🏪', order: 99 },
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
 * Inicia el scheduler de mensajes programados
 * Ejecuta cada 15 minutos durante horario laboral (7am-11pm Colombia)
 * Optimizado para 200 negocios con paralelismo de 5
 */
async function startMessageScheduler(readyPromise = null) {
  console.log('📅 Iniciando scheduler de mensajes programados');

  // Esperar a que todo esté listo (instancias WhatsApp cargadas)
  if (readyPromise) {
    console.log('📅 Esperando a que WhatsApp esté listo...');
    await readyPromise;
    console.log('📅 WhatsApp listo, continuando...');
  }

  // Ejecutar inmediatamente si estamos en horario
  if (isBusinessHours()) {
    console.log('📅 Horario laboral detectado, ejecutando scheduler inicial...');
    runScheduler().catch(err => console.error('[Scheduler] Error inicial:', err.message));
  } else {
    console.log('📅 Fuera de horario laboral, scheduler esperará...');
  }

  // Programar ejecución cada 2 minutos para que los mensajes lleguen más rápido
  setInterval(async () => {
    try {
      await runScheduler();
    } catch (err) {
      console.error('[Scheduler] Error en ejecución programada:', err.message);
    }
  }, 2 * 60 * 1000); // 2 minutos
}

/**
 * Inicia el scheduler contextual basado en agenda real
 * Ejecuta cada minuto para evaluar envíos según citas del día
 * Simula comportamiento humano indistinguible de uso manual
 */
async function startContextualScheduler(readyPromise = null) {
  console.log('🔄 Iniciando scheduler contextual (basado en agenda real)');

  // Esperar a que todo esté listo
  if (readyPromise) {
    console.log('🔄 Esperando a que WhatsApp esté listo...');
    await readyPromise;
    console.log('🔄 WhatsApp listo, iniciando scheduler contextual...');
  }

  const { runContextualScheduler } = require('./services/scheduler/contextualScheduler');

  // Ejecutar inmediatamente si estamos en horario
  if (isBusinessHours()) {
    console.log('🔄 Horario laboral detectado, ejecutando scheduler contextual inicial...');
    runContextualScheduler().catch(err => console.error('[ContextualScheduler] Error inicial:', err.message));
  }

  // Programar ejecución cada 1 minuto (evaluación en tiempo real)
  setInterval(async () => {
    try {
      if (isBusinessHours()) {
        await runContextualScheduler();
      }
    } catch (err) {
      console.error('[ContextualScheduler] Error en ejecución programada:', err.message);
    }
  }, 60 * 1000); // 1 minuto
}

/**
 * Tarea programada para limpiar mensajes históricos de BD (cada 24 horas)
 */
function startOldMessagesCleanup() {
  console.log('🧹 Iniciando limpieza automática de mensajes históricos');
  // Ejecutar inmediatamente
  cleanupOldMessages(30);
  // Y luego cada 24 horas
  setInterval(() => cleanupOldMessages(30), 24 * 60 * 60 * 1000);
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

/**
 * Tarea programada para enviar mensajes de cumpleaños (cada hora)
 */
function startBirthdayCron() {
  console.log('🎂 Iniciando monitor de cumpleaños');
  const { processBirthdays } = require('./scripts/birthdayCron');

  // Ejecutar inmediatamente al iniciar
  processBirthdays();

  // Y luego revisar cada hora (se ejecutará si son las 8 AM COL)
  setInterval(async () => {
    try {
      const now = new Date();
      const colombiaOffset = -5 * 60 * 60 * 1000;
      const colombiaTime = new Date(now.getTime() + colombiaOffset);
      const hour = colombiaTime.getUTCHours();

      // Ejecutar entre las 9:00 AM y 10:00 AM Colombia
      if (hour === 9) {
        await processBirthdays();
      }
    } catch (err) {
      console.error('[BirthdayCron] Error en ejecución programada:', err.message);
    }
  }, 60 * 60 * 1000);
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

// Variables para controlar estado de cierre
let isShuttingDown = false;
let httpServer = null;

/**
 * Limpieza graceful: detiene todas las instancias de WhatsApp/Chrome
 * y libera recursos antes de que PM2 mate el proceso
 */
async function gracefulShutdown(signal) {
  console.log(`\n🛑 Recibida señal ${signal}. Iniciando cierre graceful...`);

  if (isShuttingDown) {
    console.log('⚠️ Cierre ya en progreso...');
    return;
  }

  isShuttingDown = true;

  try {
    // 1. NOTA: NO detendremos las instancias de WhatsApp (Evolution API) al apagar el servidor
    // para permitir que las sesiones persistan y no obligar al usuario a escanear QR de nuevo.
    /*
    console.log('🔌 Cerrando instancias de WhatsApp...');
    const { stopInstance, instances } = require('./services/evolutionService');

    const instanceIds = Array.from(instances.keys());
    for (const businessId of instanceIds) {
      try {
        await stopInstance(businessId);
        console.log(`   ✅ WhatsApp detenido: ${businessId}`);
      } catch (e) {
        console.log(`   ⚠️ Error deteniendo ${businessId}: ${e.message}`);
      }
    }
    */
    console.log('🔌 Sesiones de WhatsApp preservadas (Evolution API persistente)');

    // 2. Esperar 3 segundos para que Chrome cierre completamente
    console.log('⏳ Esperando cierre de procesos Chrome...');
    await new Promise(resolve => setTimeout(resolve, 3000));

    // 3. Limpiar procesos Chrome zombie (si quedaron)
    await killChromeZombies();

    // 4. Cerrar servidor HTTP
    if (httpServer) {
      console.log('🔌 Cerrando servidor HTTP...');
      await new Promise((resolve) => {
        httpServer.close(() => {
          console.log('   ✅ Servidor HTTP cerrado');
          resolve();
        });
        // Forzar cierre después de 5 segundos
        setTimeout(resolve, 5000);
      });
    }

    // 5. Detener servicios con intervalos
    console.log('⏹️ Deteniendo servicios...');
    const { stopReminderService } = require('./services/reminderService');
    const { stopPendingAlertService } = require('./services/pendingAlertService');
    stopReminderService();
    stopPendingAlertService();
    cacheService.stop();
    console.log('   ✅ CacheService detenido');

    console.log('✅ Limpieza completada. Saliendo...');
    process.exit(0);

  } catch (err) {
    console.error('❌ Error durante cierre graceful:', err);
    process.exit(1);
  }
}

/**
 * Mata procesos Chrome zombie que puedan haber quedado
 */
async function killChromeZombies() {
  return new Promise((resolve) => {
    const { exec } = require('child_process');

    // Buscar procesos Chrome relacionados con nuestro proyecto
    const cmd = process.platform === 'win32'
      ? `taskkill /F /IM chrome.exe /FI "WINDOWTITLE eq *session-*" 2>nul`
      : `pkill -f "chrome.*session-" 2>/dev/null || true`;

    exec(cmd, (error, stdout, stderr) => {
      if (!error && stdout) {
        console.log('🧹 Procesos Chrome zombie limpiados');
      }
      resolve();
    });

    // Timeout por si el comando se cuelga
    setTimeout(resolve, 2000);
  });
}

// Manejadores de señales para PM2
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Capturar errores no manejados
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  // Un unhandledRejection suele indicar estado corrupto; forzar reinicio limpio después de loguear
  setTimeout(() => gracefulShutdown('unhandledRejection'), 1000);
});

async function start() {
  try {
    await sequelize.authenticate();
    console.log('✅  Conexión a base de datos establecida');

    try {
      await sequelize.sync({ alter: true });
      console.log('✅  Modelos sincronizados con la base de datos (alter: true)');
    } catch (syncErr) {
      console.error('⚠️  Error al sincronizar modelos (puede ser normal en PostgreSQL con ENUMs):', syncErr.message);
      console.log('💡 Intenta ejecutar las migraciones manuales si es necesario.');
    }

    await seedBusinessTypes();
    await seedSuperAdmin();

    // Crear servidor HTTP y inicializar Socket.io
    httpServer = http.createServer(app);
    const io = initializeSocketServer(httpServer);

    // Hacer io disponible globalmente para los controladores
    global.io = io;

    httpServer.listen(PORT, '0.0.0.0', async () => {
      // Notificar a PM2 que estamos listos (para wait_ready: true)
      if (process.send) process.send('ready');
      console.log(`🚀  Backend corriendo en http://localhost:${PORT}`);
      console.log(`📚  Documentación Swagger: http://localhost:${PORT}/api/docs`);
      if (DISABLE_BACKGROUND_JOBS) {
        console.log('🧯 Background jobs DESHABILITADOS (DISABLE_BACKGROUND_JOBS=true)');
        return;
      }

      // Iniciar servicio de recordatorios automáticos (1 hora antes de cada cita)
      startReminderService();
      console.log('⏰  Servicio de recordatorios automáticos iniciado');

      // Iniciar monitor de suscripciones
      startSubscriptionCheck();

      // Iniciar limpieza de mensajes viejos (cada 24 horas)
      startOldMessagesCleanup();

      // Iniciar servicio de alertas para citas pendientes no atendidas
      startPendingAlertService();
      console.log('🔔 Servicio de alertas de citas pendientes iniciado');

      // Iniciar monitor de cumpleaños
      startBirthdayCron();

      // Iniciar instancias de WhatsApp (crear promesa para que scheduler espere)
      const whatsappReadyPromise = initWhatsAppManager().then(count => {
        console.log(`✅  Instancias de WhatsApp cargadas: ${count}`);
        return count;
      }).catch(waErr => {
        console.error('⚠️  Error cargando instancias WhatsApp:', waErr.message);
        return 0;
      });

      // Iniciar scheduler de mensajes programados (esperará a WhatsApp)
      await startMessageScheduler(whatsappReadyPromise);
      console.log('📅 Scheduler de mensajes programado iniciado (cada 15 min)');

      // Iniciar scheduler contextual basado en agenda real (esperará a WhatsApp)
      await startContextualScheduler(whatsappReadyPromise);
      console.log('🔄 Scheduler contextual iniciado (cada 1 min - basado en agenda real)');
    });
  } catch (err) {
    console.error('❌  Error al iniciar:', err);
    process.exit(1);
  }
}
start(); 