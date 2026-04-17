const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode-svg');
const { WhatsAppSession, Appointment, Business, User, Service, Employee } = require('../models');

const path = require('path');
const fs = require('fs');

// Puppeteer con stealth mode para evitar detección
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

// Almacén de instancias activas en memoria
const instances = new Map();
// Almacén de QRs temporales
const currentQRs = new Map();
// Cola de mensajes para evitar bloqueos
const messageQueue = [];
let isProcessingQueue = false;

// Control anti-bloqueo: contador de mensajes por hora por negocio
const messageCounts = new Map(); // businessId -> { hour: number, count: number }
const MAX_MESSAGES_PER_HOUR = 20; // Límite seguro de WhatsApp

// Límite de instancias concurrentes para proteger memoria del servidor
const MAX_INSTANCES = 3; // Máximo 3 negocios con WhatsApp simultáneo

// Variaciones de mensajes para que no sean idénticos
const GREETING_VARIATIONS = ['Hola', '¡Hola!', 'Buen día', '¡Buen día!', 'Hola 👋', '¡Hey!'];
const FAREWELL_VARIATIONS = ['¡Gracias!', 'Gracias', '¡Que tenga buen día!', '¡Hasta pronto!', '¡Nos vemos!'];
const EMOJI_SETS = ['🕒', '⏰', '📅', '🗓️', '✨', '💫'];

// Plantillas variadas para mensajes de confirmación de citas
const CONFIRMATION_TEMPLATES = [
  '✅ ¡Perfecto! Tu cita ha sido confirmada. Te esperamos 😊',
  '🎉 ¡Listo! Asistencia confirmada. ¡Gracias por elegirnos! 🙏',
  '👍 ¡Confirmado! Tu cita está agendada. ¡Nos vemos pronto!',
  '✨ ¡Excelente! Tu asistencia ha sido registrada. Te esperamos con gusto 💫',
  '📅 ¡Confirmado! Gracias por confirmar tu cita. ¡Hasta luego! 👋',
  '💯 ¡Todo listo! Cita confirmada exitosamente. ¡Gracias! 🌟',
  '🤝 ¡Gracias por confirmar! Te esperamos en tu cita programada.',
  '👌 ¡Perfecto! Asistencia confirmada. ¡Que tengas un excelente día! ☀️'
];

// Plantillas variadas para recordatorios de citas
const REMINDER_TEMPLATES = [
  { intro: 'Hola *{name}*, te recordamos tu cita de *{service}* en *{business}* para hoy a las *{time}*.', question: '¿Confirmas tu asistencia?' },
  { intro: '👋 *{name}*, recordatorio: tienes cita de *{service}* hoy a las *{time}* en *{business}*.', question: '¿Asistirás?' },
  { intro: '⏰ *{name}*, tu cita de *{service}* en *{business}* es hoy a las *{time}*.', question: '¿Podrás asistir?' },
  { intro: '📅 Hola *{name}*, te escribimos de *{business}* para recordarte tu cita de *{service}* hoy a las *{time}*.', question: '¿Vas a poder ir?' },
  { intro: '✨ *{name}*, recordatorio de tu cita de *{service}* en *{business}* para las *{time}* de hoy.', question: '¿Confirmas asistencia?' }
];

// Plantillas variadas para calificaciones
const RATING_TEMPLATES = [
  '⭐ ¿Cómo fue tu experiencia? Responde con una calificación del 1 al 5. ¡Tu opinión nos ayuda!',
  '🌟 ¡Esperamos que todo haya salido bien! ¿Nos calificarías del 1 al 5? Tu feedback es valioso 💬',
  '💫 ¿Cómo te fue en tu visita? Responde del 1 al 5 y ayúdanos a mejorar. ¡Gracias! 🙏',
  '😊 Esperamos que hayas tenido una excelente experiencia. ¿Nos das una calificación del 1 al 5?',
  '👋 ¿Cómo estuvo tu cita? Tu calificación del 1 al 5 nos ayuda mucho. ¡Gracias por confiar en nosotros!'
];

// Plantillas variadas para agradecimiento de calificación
const RATING_THANKS_TEMPLATES = [
  (rating) => `🌟 ¡Gracias por calificar con ${'⭐'.repeat(rating)}! Nos ayuda mucho.`,
  (rating) => `💫 ¡Excelente! Gracias por tu ${'⭐'.repeat(rating)}. Tu opinión nos hace mejores.`,
  (rating) => `🙏 ¡Agradecemos tu ${'⭐'.repeat(rating)}! Gracias por tomarte el tiempo de calificarnos.`,
  (rating) => `⭐⭐⭐ ¡Genial! Tu calificación de ${rating} estrellas ha sido guardada. ¡Gracias!`,
  (rating) => `🎉 ¡Perfecto! Gracias por tu ${'⭐'.repeat(rating)}. Tu feedback es muy valioso para nosotros.`
];

/**
 * Genera un delay aleatorio entre mensajes para simular comportamiento humano
 * Entre 45 segundos y 3 minutos
 */
function getRandomDelay() {
  return Math.floor(Math.random() * (180000 - 60000 + 1)) + 60000; // 60 segundos a 3 minutos
}

/**
 * Verifica si es horario laboral (7:00 AM - 11:00 PM Colombia)
 * WhatsApp puede bloquear números que envían fuera de horarios normales
 * Colombia es UTC-5 (todo el año, no tiene horario de verano)
 * NOTA: Horario extendido hasta las 11 PM para pruebas
 */
function isBusinessHours() {
  const now = new Date();
  // Convertir UTC a hora Colombia (UTC-5)
  const colombiaOffset = -5 * 60 * 60 * 1000; // -5 horas en ms
  const colombiaTime = new Date(now.getTime() + colombiaOffset);
  const hour = colombiaTime.getUTCHours(); // Usar getUTCHours porque ya convertimos
  return hour >= 7 && hour < 23; // 7:00 AM - 11:00 PM Colombia (extendido para pruebas)
}

/**
 * Verifica si el negocio puede enviar más mensajes esta hora
 */
function canSendMessage(businessId) {
  const now = new Date();
  // Convertir a hora Colombia (UTC-5)
  const colombiaOffset = -5 * 60 * 60 * 1000;
  const colombiaTime = new Date(now.getTime() + colombiaOffset);
  const currentHour = colombiaTime.getUTCHours();

  const countData = messageCounts.get(businessId);
  if (!countData || countData.hour !== currentHour) {
    messageCounts.set(businessId, { hour: currentHour, count: 1 });
    return true;
  }

  if (countData.count >= MAX_MESSAGES_PER_HOUR) {
    console.log(`[WhatsApp] ⚠️ Límite de ${MAX_MESSAGES_PER_HOUR} mensajes/hora alcanzado para ${businessId}`);
    return false;
  }

  countData.count++;
  return true;
}

/**
 * Simula "escribiendo..." antes de enviar mensaje
 */
async function simulateTyping(client, chatId, durationMs = 2000) {
  try {
    const chat = await client.getChatById(chatId);
    await chat.sendStateTyping();
    await new Promise(resolve => setTimeout(resolve, durationMs));
    await chat.clearState();
  } catch (e) {
    // Ignorar errores de simulación
  }
}

/**
 * Agrega variaciones naturales al texto del mensaje
 */
function humanizeMessage(text) {
  // Variar espacios al inicio (algunos mensajes con espacio, otros no)
  if (Math.random() > 0.7) {
    text = ' ' + text;
  }

  // Reemplazar emojis por variaciones aleatorias
  if (text.includes('🕒') || text.includes('⏰') || text.includes('📅')) {
    const randomEmoji = EMOJI_SETS[Math.floor(Math.random() * EMOJI_SETS.length)];
    text = text.replace(/[🕒⏰📅🗓️]/g, randomEmoji);
  }

  return text;
}

/**
 * Selecciona una plantilla aleatoria de confirmación
 */
function getRandomConfirmationTemplate() {
  return CONFIRMATION_TEMPLATES[Math.floor(Math.random() * CONFIRMATION_TEMPLATES.length)];
}

/**
 * Selecciona una plantilla aleatoria de recordatorio
 */
function getRandomReminderTemplate() {
  return REMINDER_TEMPLATES[Math.floor(Math.random() * REMINDER_TEMPLATES.length)];
}

/**
 * Selecciona una plantilla aleatoria de calificación
 */
function getRandomRatingTemplate() {
  return RATING_TEMPLATES[Math.floor(Math.random() * RATING_TEMPLATES.length)];
}

/**
 * Verifica si un negocio tiene sesión de WhatsApp válida (archivos existen)
 * Sin necesidad de tener Chrome corriendo
 */
function hasValidSession(businessId) {
  const sessionDir = path.resolve(__dirname, `../../sessions/session-${businessId}`);
  return fs.existsSync(sessionDir) && fs.existsSync(path.join(sessionDir, 'Default'));
}

/**
 * Inicializa el gestor de WhatsApp para todos los negocios que tengan sesión
 * Modo 'bajo demanda' - Chrome solo se inicia cuando se necesita, no al arrancar
 */
async function initWhatsAppManager() {
  console.log('[WhatsApp] 🚀 Iniciando gestor de instancias (modo bajo demanda)...');
  try {
    const sessions = await WhatsAppSession.findAll();
    
    for (const session of sessions) {
      // Verificar si tiene sesión válida en disco
      const isSessionValid = hasValidSession(session.businessId);
      
      if (isSessionValid) {
        // Hay sesión guardada pero Chrome NO está corriendo
        // Estado especial: 'session_saved' = listo para conectar con 1 clic
        await WhatsAppSession.update(
          { status: 'session_saved', lastActivity: new Date() },
          { where: { businessId: session.businessId } }
        );
        console.log(`[WhatsApp] 💾 Sesión guardada disponible para ${session.businessId} (listo para conectar)`);
      } else {
        // No hay archivos de sesión válidos
        await WhatsAppSession.update(
          { status: 'disconnected' },
          { where: { businessId: session.businessId } }
        );
        console.log(`[WhatsApp] ⚠️ Sin sesión para ${session.businessId}`);
      }
    }
    
    console.log(`[WhatsApp] 📊 Gestor listo. Las sesiones se conectarán bajo demanda (0 Chrome activos).`);
  } catch (err) {
    console.error('[WhatsApp] ❌ Error crítico en initWhatsAppManager:', err.message);
  }

  // Iniciar monitoreo de memoria cada 5 minutos
  setInterval(() => {
    const used = process.memoryUsage();
    const instancesCount = instances.size;
    console.log(`[WhatsApp] 📊 Memoria - Heap: ${Math.round(used.heapUsed / 1024 / 1024)}MB / ${Math.round(used.heapTotal / 1024 / 1024)}MB | RSS: ${Math.round(used.rss / 1024 / 1024)}MB | Instancias: ${instancesCount}/${MAX_INSTANCES}`);
  }, 5 * 60 * 1000);
}

/**
 * Limpia archivos de bloqueo que Chrome deja cuando se cierra mal
 */
async function cleanLockFiles(businessId) {
  const sessionDir = path.resolve(__dirname, `../../sessions/session-${businessId}`);
  if (fs.existsSync(sessionDir)) {
    const lockFiles = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];
    lockFiles.forEach(file => {
      const lockPath = path.join(sessionDir, file);
      if (fs.existsSync(lockPath)) {
        try {
          fs.unlinkSync(lockPath);
          console.log(`[WhatsApp] 🧹 Archivo de bloqueo eliminado: ${file}`);
        } catch (e) { }
      }
    });
  }
}

/**
 * Crea o recupera una instancia de WhatsApp para un negocio
 */
async function createInstance(businessId, forceFresh = false) {
  const sessionsDir = path.resolve(__dirname, '../../sessions');
  const authPath = path.join(sessionsDir, `session-${businessId}`);

  if (!fs.existsSync(sessionsDir)) fs.mkdirSync(sessionsDir, { recursive: true });

  // Verificar límite de instancias para proteger memoria del servidor
  if (instances.size >= MAX_INSTANCES && !instances.has(businessId)) {
    console.error(`[WhatsApp] ❌ Límite de ${MAX_INSTANCES} instancias alcanzado. No se puede crear sesión para ${businessId}`);
    throw new Error(`Límite de ${MAX_INSTANCES} instancias de WhatsApp alcanzado. Desconecta otra sesión primero.`);
  }

  // 1. Cierre forzoso de instancia previa si existe en el MAP
  const existingClient = instances.get(businessId);
  if (existingClient || forceFresh) {
    console.log(`[WhatsApp] 🛑 Cerrando instancia previa para ${businessId}...`);
    if (existingClient) {
      try {
        await Promise.race([
          existingClient.destroy(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout destroy')), 5000))
        ]);
      } catch (e) {
        console.warn(`[WhatsApp] ⚠️ No se pudo cerrar limpiamente, continuando...`);
      }
      instances.delete(businessId);
    }
    currentQRs.delete(businessId);

    // Si es forceFresh o hubo error, limpiar carpeta o bloqueos
    if (forceFresh) {
      if (fs.existsSync(authPath)) {
        try {
          fs.rmSync(authPath, { recursive: true, force: true });
          console.log(`[WhatsApp] ✅ Carpeta de sesión eliminada para ${businessId}`);
        } catch (e) { }
      }
    } else {
      // Si no es fresh, al menos limpiar los locks de Chrome
      await cleanLockFiles(businessId);
    }

    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log(`[WhatsApp] ⚙️ Iniciando cliente para ${businessId}...`);

  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: businessId, // Usar el ID del negocio directamente (UUID)
      dataPath: sessionsDir
    }),
    puppeteer: {
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-site-isolation-trials',
        '--disable-blink-features=AutomationControlled',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-features=TranslateUI',
        '--disable-ipc-flooding-protection',
        '--js-flags=--max-old-space-size=256 --max-semi-space-size=32',
        '--memory-pressure-off',
        '--window-size=1280,720',
        '--start-maximized'
      ],
      executablePath: process.env.CHROME_PATH || undefined,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 },
      defaultViewport: { width: 1280, height: 720 }
    }
  });

  // Manejar QR
  client.on('qr', async (qr) => {
    console.log(`[WhatsApp] 📲 QR generado para BIZ-ID: ${businessId}`);
    try {
      // Convertir el string QR en un SVG base64 para el frontend
      const qrSvg = new QRCode({
        content: qr,
        padding: 4,
        width: 256,
        height: 256,
        color: '#000000',
        background: '#ffffff',
        ecl: 'M'
      }).svg();

      const base64 = Buffer.from(qrSvg).toString('base64');
      const dataUri = `data:image/svg+xml;base64,${base64}`;

      console.log(`[WhatsApp] ✅ QR DataURI generado con éxito para BIZ-ID: ${businessId}`);
      currentQRs.set(businessId, dataUri);
      await WhatsAppSession.upsert({ businessId, status: 'connecting' });
    } catch (e) {
      console.error(`[WhatsApp] ❌ Error generando imagen para BIZ-ID: ${businessId}:`, e.message);
      currentQRs.set(businessId, qr);
    }
  });

  // Conexión lista
  client.on('ready', async () => {
    console.log(`[WhatsApp] ✅ Cliente ${businessId} listo y conectado`);
    currentQRs.delete(businessId);
    await WhatsAppSession.update({ status: 'connected' }, { where: { businessId } });
    
    // Ocultar señales de automatización para evitar detección
    try {
      if (client.pupPage) {
        await client.pupPage.evaluateOnNewDocument(() => {
          // Ocultar navigator.webdriver
          Object.defineProperty(navigator, 'webdriver', {
            get: () => undefined
          });
          // Ocultar chrome.runtime
          window.chrome = { runtime: {} };
          // Ocultar permisos de notificación
          const originalQuery = window.navigator.permissions.query;
          window.navigator.permissions.query = (parameters) => (
            parameters.name === 'notifications' ?
              Promise.resolve({ state: Notification.permission }) :
              originalQuery(parameters)
          );
        });
        console.log(`[WhatsApp] 🔒 Stealth mode activado para ${businessId}`);
      }
    } catch (stealthErr) {
      console.warn(`[WhatsApp] ⚠️ No se pudo activar stealth mode:`, stealthErr.message);
    }
  });

  // Autenticación fallida
  client.on('auth_failure', async (msg) => {
    console.error(`[WhatsApp] ❌ Fallo de autenticación para ${businessId}:`, msg);
    await WhatsAppSession.update({ status: 'disconnected' }, { where: { businessId } });
    instances.delete(businessId);
    currentQRs.delete(businessId);
  });

  // Desconexión
  client.on('disconnected', async (reason) => {
    console.log(`[WhatsApp] ❌ Cliente ${businessId} desconectado:`, reason);
    await WhatsAppSession.update({ status: 'disconnected' }, { where: { businessId } });
    instances.delete(businessId);
    currentQRs.delete(businessId);

    // Limpiar archivos de sesión
    if (fs.existsSync(authPath)) {
      try {
        fs.rmSync(authPath, { recursive: true, force: true });
      } catch (e) { }
    }
  });

  // Escuchar mensajes entrantes
  client.on('message_create', async (msg) => {
    if (!msg.fromMe && msg.body) {
      await handleClientResponse(businessId, client, msg);
    }
  });

  // Inicializar cliente con manejo de errores y retry
  let initAttempts = 0;
  const maxInitAttempts = 3;

  while (initAttempts < maxInitAttempts) {
    initAttempts++;
    try {
      console.log(`[WhatsApp] 🔄 Intento de inicialización ${initAttempts}/${maxInitAttempts} para ${businessId}...`);
      // Dar tiempo a que Chrome se cargue completamente
      await new Promise(resolve => setTimeout(resolve, 2000));
      await client.initialize();
      instances.set(businessId, client);
      console.log(`[WhatsApp] ✅ Cliente ${businessId} inicializado correctamente`);
      return client;
    } catch (err) {
      console.error(`[WhatsApp] ❌ Intento ${initAttempts}/${maxInitAttempts} fallido para ${businessId}:`, err.message);

      // Limpiar instancia fallida antes de reintentar
      try {
        await client.destroy();
      } catch (e) { }

      if (initAttempts < maxInitAttempts) {
        console.log(`[WhatsApp] 🔄 Reintentando en 5 segundos con una instancia nueva...`);
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Es mejor crear una instancia nueva para el siguiente reintento
        return createInstance(businessId, false);
      } else {
        // Último intento fallido, limpiar todo
        instances.delete(businessId);
        currentQRs.delete(businessId);
        // Limpiar sesión corrupta
        if (fs.existsSync(authPath)) {
          try { fs.rmSync(authPath, { recursive: true, force: true }); } catch (e) { }
        }
        await WhatsAppSession.update({ status: 'disconnected' }, { where: { businessId } });
        throw err;
      }
    }
  }
}

/**
 * Maneja la respuesta del cliente (1 para Sí, 2 para No)
 */
async function handleClientResponse(businessId, client, msg) {
  // 0. Ignorar estados de WhatsApp, grupos y difusiones de forma segura
  const from = String(msg.from || '').toLowerCase();
  if (from === 'status@broadcast' || from.includes('@g.us') || from.includes('@broadcast')) {
    return;
  }

  // Limpiar el texto entrante: quitar asteriscos, espacios y convertir a minúsculas
  const text = (msg.body || '').trim().toLowerCase().replace(/\*/g, '');

  // 1. Obtener el teléfono del remitente de la forma más confiable posible
  let rawPhone = from.replace(/\D/g, '');
  let extractedFromLid = false;

  // Si el ID parece ser un ID interno (muy largo) y no un teléfono, intentamos obtenerlo del contacto
  // o extraerlo del propio ID de WhatsApp (formato LID: numero@c.us o @lid)
  if (rawPhone.length > 15 || from.includes('@lid')) {
    try {
      const contact = await msg.getContact();
      if (contact && contact.number) {
        rawPhone = String(contact.number).replace(/\D/g, '');
        console.log(`[WhatsApp] 👤 ID largo detectado (${from}), obtenido número real del contacto: ${rawPhone}`);
      }
    } catch (e) {
      // Si no podemos obtener el contacto, intentar extraer del ID largo
      // WhatsApp LID IDs pueden contener el número en diferentes posiciones
      console.warn(`[WhatsApp] ⚠️ No se pudo obtener el contacto para el ID ${from}, intentando extraer del ID`);
    }

    // Si aún no tenemos un número válido o sigue siendo muy largo,
    // intentar extraer los últimos 11-12 dígitos que podrían ser el número colombiano completo (57310xxxxxxx)
    if (rawPhone.length > 12) {
      // Buscar patrón de número colombiano (57 + 10 dígitos, o 3 seguido de 9 dígitos)
      const colombiaMatch = rawPhone.match(/(57\d{10}|\d{3}[0-9]{9})$/);
      if (colombiaMatch) {
        rawPhone = colombiaMatch[1];
        extractedFromLid = true;
        console.log(`[WhatsApp] 📞 Número extraído de ID LID: ${rawPhone}`);
      }
    }
  }

  // Si después de limpiar no hay números, ignorar (caso de IDs raros o vacíos)
  if (!rawPhone || rawPhone === '') {
    return;
  }

  // Normalizar número colombiano: si empieza con 0, quitarlo (es prefijo de larga distancia)
  // y agregar 3 al inicio para hacerlo un móvil colombiano válido
  if (rawPhone.length === 10 && rawPhone.startsWith('0')) {
    rawPhone = '3' + rawPhone.substring(1);
    console.log(`[WhatsApp] 📞 Normalizado número con prefijo 0: ${rawPhone}`);
  }

  // Si tiene prefijo 57 (Colombia), quitarlo para comparar
  let cleanIncomingPhone = rawPhone;
  if (rawPhone.startsWith('57') && rawPhone.length === 12) {
    cleanIncomingPhone = rawPhone.substring(2);
  }

  // Tomar los últimos 10 dígitos para comparación
  cleanIncomingPhone = cleanIncomingPhone.slice(-10);
  console.log(`[WhatsApp] 📥 Mensaje de: ${from} | Texto: "${text}" | Tel: ${cleanIncomingPhone} | BIZ: ${businessId}`);

  // 1.5. Buscar primero por CÓDIGO DE REFERENCIA en el mensaje
  const { extractReferenceCode } = require('../utils/referenceCode');
  const refCode = extractReferenceCode(text);

  if (refCode) {
    console.log(`[WhatsApp] 🔍 Código de referencia detectado: ${refCode}`);

    // Buscar cita directamente por código de referencia
    const sessionOwnerId = await Business.resolveWhatsAppBusinessId(businessId);
    const sharingBusinesses = await Business.findAll({
      where: {
        [require('sequelize').Op.or]: [
          { id: sessionOwnerId },
          { parentBusinessId: sessionOwnerId, useParentWhatsApp: true }
        ]
      },
      attributes: ['id']
    });
    const businessIds = sharingBusinesses.map(b => b.id);

    const apptByRef = await Appointment.findOne({
      where: {
        referenceCode: refCode,
        businessId: { [require('sequelize').Op.in]: businessIds }
      }
    });

    if (apptByRef) {
      console.log(`[WhatsApp] ✅ Cita encontrada por código de referencia: ${apptByRef.id.slice(0, 8)}`);
      // Procesar esta cita específica
      await processAppointmentResponse(apptByRef, text, msg, cleanIncomingPhone);
      return; // Terminar aquí, ya procesamos la cita específica
    } else {
      console.log(`[WhatsApp] ⚠️ Código ${refCode} no encontrado en BD, continuando con búsqueda por teléfono...`);
    }
  }

  // 2. Buscar citas para este negocio y sus sucursales (si comparten WhatsApp)
  // Obtenemos el ID del negocio "dueño" de la sesión para buscar en toda su red
  const sessionOwnerId = await Business.resolveWhatsAppBusinessId(businessId);

  const sharingBusinesses = await Business.findAll({
    where: {
      [require('sequelize').Op.or]: [
        { id: sessionOwnerId },
        { parentBusinessId: sessionOwnerId, useParentWhatsApp: true }
      ]
    },
    attributes: ['id']
  });
  const businessIds = sharingBusinesses.map(b => b.id);

  // Buscar primero citas ACTIVAS (para confirmación/cancelación) y luego citas DONE (para calificación)
  const now = new Date();
  const activeAppts = await Appointment.findAll({
    where: { 
      businessId: { [require('sequelize').Op.in]: businessIds },
      status: { [require('sequelize').Op.in]: ['pending', 'confirmed', 'attention'] },
      startTime: { [require('sequelize').Op.gte]: now } // Solo citas FUTURAS
    },
    order: [['startTime', 'ASC']] // La más próxima primero
  });

  const doneAppts = await Appointment.findAll({
    where: { 
      businessId: { [require('sequelize').Op.in]: businessIds },
      status: 'done',
      rating: null, // Solo citas SIN calificar aún
      ratingSent: true, // Solo citas donde se ENVIÓ la solicitud
      ratingSentAt: { [require('sequelize').Op.gte]: new Date(now - 48 * 60 * 60 * 1000) } // Solo últimas 48h
    },
    order: [['ratingSentAt', 'DESC']] // Priorizar la cita cuya solicitud se envió más recientemente
  });

  // Combinar: primero activas, luego done (para dar prioridad a confirmación sobre calificación)
  const recentAppts = [...activeAppts, ...doneAppts];

  console.log(`[WhatsApp] 🔍 Buscando en ${recentAppts.length} citas (${activeAppts.length} activas, ${doneAppts.length} con solicitud enviada) de ${businessIds.length} negocios vinculados`);

  // LOG CRÍTICO PARA DEPURACIÓN: Ver qué citas se están comparando
  recentAppts.forEach(a => {
    const dbPhone = String(a.clientPhone || '').replace(/\D/g, '');
    console.log(`   -> Cita ${a.id.slice(0, 8)} | Tel DB: ${dbPhone} | Status: ${a.status}`);
  });

  // 3. Filtrar por teléfono con lógica ultra-flexible - OBTENER TODAS las citas coincidentes
  const matchedAppointments = recentAppts.filter(appt => {
    if (!appt.clientPhone) return false;

    const dbPhone = String(appt.clientPhone).replace(/\D/g, '');
    let dbPhoneLast10 = dbPhone.slice(-10);

    // Normalizar número de DB si empieza con 0 (convertir a formato 3xx)
    if (dbPhoneLast10.length === 10 && dbPhoneLast10.startsWith('0')) {
      dbPhoneLast10 = '3' + dbPhoneLast10.substring(1);
    }

    // A. Coincidencia exacta de últimos 10 dígitos (el caso más común)
    if (dbPhoneLast10 === cleanIncomingPhone) return true;

    // B. El teléfono de la DB está contenido en el ID largo de WhatsApp
    if (from.includes(dbPhoneLast10) && dbPhoneLast10.length >= 7) return true;

    // C. El ID de WhatsApp termina en el teléfono de la DB
    if (from.endsWith(dbPhone)) return true;

    // D. Comparar sin el prefijo 57 de Colombia
    if (dbPhone.startsWith('57')) {
      const dbNoPrefix = dbPhone.substring(2);
      if (dbNoPrefix === cleanIncomingPhone || dbNoPrefix.slice(-10) === cleanIncomingPhone) return true;
    }

    // E. Match parcial de últimos 7 dígitos (para números similares con prefijos diferentes)
    const dbPhoneLast7 = dbPhoneLast10.slice(-7);
    const incomingLast7 = cleanIncomingPhone.slice(-7);
    if (dbPhoneLast7 === incomingLast7 && dbPhoneLast7.length >= 7) return true;

    return false;
  });

  if (matchedAppointments.length === 0) {
    console.log(`[WhatsApp] 🔍 Sin coincidencias para tel: ${cleanIncomingPhone} (ID: ${from}) en BIZ: ${businessId}`);
    console.log(`[WhatsApp] 💾 Guardando mensaje entrante para procesamiento posterior...`);
    
    // Guardar mensaje en BD para procesarlo cuando haya citas
    try {
      const { IncomingMessage } = require('../models');
      await IncomingMessage.create({
        businessId: businessId,
        phone: cleanIncomingPhone,
        message: text,
        whatsappMessageId: msg.id?._serialized || null,
        status: 'pending'
      });
      console.log(`[WhatsApp] ✅ Mensaje entrante guardado en BD para tel: ${cleanIncomingPhone}`);
    } catch (saveErr) {
      console.error(`[WhatsApp] ❌ Error guardando mensaje entrante:`, saveErr.message);
    }
    return;
  }

  console.log(`[WhatsApp] 📍 Encontradas ${matchedAppointments.length} citas para tel:${cleanIncomingPhone}`);
  console.log(`[WhatsApp] 📝 MENSAJE RECIBIDO: "${text}" (length: ${text.length})`);
  matchedAppointments.forEach((appt, idx) => {
    const sentAt = appt.ratingSentAt ? new Date(appt.ratingSentAt).toLocaleTimeString('es-CO', {hour: '2-digit', minute:'2-digit'}) : 'N/A';
    console.log(`   -> [${idx + 1}] ID:${appt.id.slice(0, 8)} | status:${appt.status} | flow:${appt.messageFlowStatus} | ${appt.clientName} | ratingSent:${appt.ratingSent} @ ${sentAt}`);
  });

  // Usar messageFlowStatus para determinar la acción - mucho más simple y confiable
  // messageFlowStatus: 'not_started' | 'awaiting_confirmation' | 'awaiting_rating' | 'completed'
  
  // Detectar si el mensaje es un número (1-5) - SOLO para calificación
  // Confirmación/Cancelación ahora usa SI/NO (texto), no números
  const numberMatch = text.match(/^\s*([1-5])\s*$/);
  const number = numberMatch ? parseInt(numberMatch[1]) : null;
  const isRatingNumber = number && (number >= 1 && number <= 5);
  
  let matchedAppt = null;
  let actionType = 'unknown';
  
  // 3.1. Buscar citas por messageFlowStatus
  const awaitingConfirmation = matchedAppointments.filter(a => a.messageFlowStatus === 'awaiting_confirmation');
  const awaitingRating = matchedAppointments.filter(a => a.messageFlowStatus === 'awaiting_rating');
  
  // 3.2. Decidir qué cita procesar
  if (isRatingNumber && awaitingRating.length > 0) {
    // Número 1-5 con cita esperando calificación → CALIFICAR
    matchedAppt = awaitingRating[0];
    actionType = 'rating';
    console.log(`[WhatsApp] ⭐ Número ${number} detectado → CALIFICACIÓN: ${matchedAppt.id.slice(0, 8)}`);
  } else if (awaitingConfirmation.length > 0) {
    // Hay cita esperando confirmación (SI/NO)
    matchedAppt = awaitingConfirmation[0];
    actionType = 'confirm_cancel';
    console.log(`[WhatsApp] 🎯 Cita esperando confirmación (SI/NO): ${matchedAppt.id.slice(0, 8)}`);
  } else if (awaitingRating.length > 0) {
    // Solo hay cita esperando calificación
    matchedAppt = awaitingRating[0];
    actionType = 'rating';
    console.log(`[WhatsApp] ⭐ Solo cita esperando calificación: ${matchedAppt.id.slice(0, 8)}`);
  } else {
    // Fallback: buscar cita pendiente o completada
    const pendingAppt = matchedAppointments.find(a => ['pending', 'confirmed', 'attention'].includes(a.status) && !a.confirmed);
    const recentDoneAppt = matchedAppointments.find(a => a.status === 'done' && !a.rating);
    matchedAppt = pendingAppt || recentDoneAppt || matchedAppointments[0];
    actionType = 'fallback';
    console.log(`[WhatsApp] 🎯 Fallback: ${matchedAppt.id.slice(0, 8)} | messageFlowStatus: ${matchedAppt.messageFlowStatus || 'not_started'}`);
  }

  // 4. Lógica de Confirmación/Cancelación (para citas no terminadas)
  // Permitir confirmar si: está en status pendiente/confirmed/attention Y (no está confirmada O está esperando confirmación)
  const canConfirmCancel = ['pending', 'confirmed', 'attention'].includes(matchedAppt.status) && 
                           (!matchedAppt.confirmed || matchedAppt.messageFlowStatus === 'awaiting_confirmation');
  
  console.log(`[WhatsApp] 🔍 Verificando confirmación: status=${matchedAppt.status}, confirmed=${matchedAppt.confirmed}, messageFlowStatus=${matchedAppt.messageFlowStatus}, canConfirmCancel=${canConfirmCancel}`);
  
  if (canConfirmCancel) {
    // Palabras clave para confirmar - ahora usamos SI/NO en lugar de 1/2 para evitar confusión con calificación 1-5
    // Regex flexible: SI o SÍ al inicio, permitiendo espacios y caracteres de puntuación después
    const isConfirm = /^(si|sí)[\s\.\,\!\?]*$/i.test(text) || 
                       /confirm|asistir[eé]|allá nos vemos|listo|^ok$|dale|perfecto/i.test(text);
    
    // Palabras clave para cancelar - ahora usamos SI/NO en lugar de 1/2
    // Regex flexible: NO al inicio, permitiendo espacios y caracteres de puntuación después
    const isCancel = /^(no)[\s\.\,\!\?]*$/i.test(text) || 
                      /cancel|no puedo|no voy|no asistir[eé]|eliminar/i.test(text);
    
    console.log(`[WhatsApp] 🔍 isConfirm=${isConfirm}, isCancel=${isCancel}, texto="${text}"`);

    if (isConfirm) {
      console.log(`[WhatsApp] ✅ Confirmando cita ${matchedAppt.id} (mensaje: "${msg.body}")`);
      try {
        await matchedAppt.update({
          status: 'confirmed',
          confirmed: true,
          confirmedAt: new Date(),
          messageFlowStatus: 'not_started' // Ya no esperamos más respuestas por ahora
        });
        // ... rest of logic ...

        console.log(`[WhatsApp] ✅ Cita ${matchedAppt.id} confirmada exitosamente en BD`);

        const chat = await msg.getChat();
        await chat.sendStateTyping();
        setTimeout(async () => {
          try {
            await msg.reply(getRandomConfirmationTemplate());
            console.log(`[WhatsApp] ✅ Respuesta de confirmación enviada a cliente`);
          } catch (e) { 
            console.error(`[WhatsApp] Error enviando respuesta confirmación:`, e.message); 
          }
        }, 2000); // 2 segundos (más rápido para mejor UX)
        return; // IMPORTANTE: Salir aquí para no caer en calificación
      } catch (confirmErr) {
        console.error(`[WhatsApp] ❌ Error actualizando cita en BD:`, confirmErr.message);
        return;
      }
    }

    if (isCancel) {
      console.log(`[WhatsApp] ❌ Cancelando cita ${matchedAppt.id} (mensaje: "${msg.body}")`);
      try {
        await matchedAppt.update({ 
          status: 'cancelled',
          messageFlowStatus: 'completed' // Flujo terminado
        });
        console.log(`[WhatsApp] ✅ Cita ${matchedAppt.id} cancelada exitosamente en BD | messageFlowStatus: completed`);
        
        const chat = await msg.getChat();
        await chat.sendStateTyping();
        setTimeout(async () => {
          try {
            const templates = [
              '✅ Cita cancelada exitosamente.',
              '👍 Confirmamos la cancelación. ¡Hasta pronto!',
              '📅 Cita cancelada. Escríbenos si necesitas reagendar.'
            ];
            await msg.reply(templates[Math.floor(Math.random() * templates.length)]);
          } catch (e) { 
            console.error(`[WhatsApp] Error enviando respuesta cancelación:`, e.message); 
          }
        }, 2000);
        return;
      } catch (cancelErr) {
        console.error(`[WhatsApp] ❌ Error cancelando cita en BD:`, cancelErr.message);
        return;
      }
    }
    
    // Si llegó aquí, el mensaje no fue ni confirmación ni cancelación válida
    // Continuar a otras lógicas (como calificación si aplica)
  }

  // 5. Lógica de Calificación (SOLO para citas terminadas o esperando calificación)
  const canRate = (matchedAppt.messageFlowStatus === 'awaiting_rating') || 
                  (matchedAppt.status === 'done' && !matchedAppt.rating);

  if (canRate) {
    // Regex estricto para calificación: el número debe estar solo o ser lo único relevante
    const match = text.match(/^\s*([1-5])\s*$/);
    
    if (match) {
      const rating = parseInt(match[1]);
      console.log(`[WhatsApp] ⭐ Calificando cita ${matchedAppt.id} con ${rating} (mensaje: "${msg.body}")`);
      try {
        // Actualizar con rating y marcar ratingSent para evitar duplicados
        await matchedAppt.update({
          rating,
          ratingSent: true,
          status: 'done',
          messageFlowStatus: 'completed'
        });
        console.log(`[WhatsApp] ✅ Calificación guardada en BD para cita ${matchedAppt.id}`);

        // Programar mensaje de agradecimiento extendido usando scheduler (persistente)
        // Solo para calificaciones 1-5 (no para cancelaciones que pueden usar otros números)
        try {
          const { scheduleMessage } = require('./schedulerService');
          const thankYouTemplates = [
            `🙏 ¡Hola de nuevo *${matchedAppt.clientName}*! Queríamos agradecerte por tomarte el tiempo de calificar nuestro servicio. Tu opinión nos ayuda a mejorar cada día. ¡Te esperamos pronto! ✨`,
            `💫 *${matchedAppt.clientName}*, gracias por tu calificación. Valoramos mucho tu feedback y trabajamos constantemente para ofrecerte la mejor experiencia. ¡Hasta la próxima! 🌟`,
            `🎉 ¡Gracias *${matchedAppt.clientName}*! Tu calificación ha sido recibida. Nos motiva a seguir dando lo mejor. ¡Que tengas un excelente día! ☀️`
          ];
          const randomThankYou = thankYouTemplates[Math.floor(Math.random() * thankYouTemplates.length)];

          // Enviar mensaje de agradecimiento 1 minuto después (solo para calificaciones 1-5)
          const thankYouTime = new Date(Date.now() + 60 * 1000); // 1 minuto después
          await scheduleMessage({
            businessId: matchedAppt.businessId,
            appointmentId: matchedAppt.id,
            phone: cleanIncomingPhone,
            message: randomThankYou,
            type: 'custom',
            scheduledAt: thankYouTime
          });

          // Marcar en la cita que se programó el mensaje de agradecimiento
          await matchedAppt.update({
            thankYouMessageSent: true,
            thankYouMessageSentAt: thankYouTime
          });

          console.log(`[WhatsApp] 💚 Mensaje de agradecimiento programado en BD (1min) para cita ${matchedAppt.id}`);
        } catch (scheduleErr) {
          console.error(`[WhatsApp] Error programando agradecimiento:`, scheduleErr.message);
        }

        return;
      } catch (err) {
        console.error(`[WhatsApp] ❌ Error guardando calificación:`, err.message);
      }
    } else {
      // El mensaje contiene un número pero no es formato válido de calificación
      console.log(`[WhatsApp] ℹ️ Mensaje contiene número pero no es calificación válida (formato: 1-5 solos). Msg: "${msg.body}"`);
    }
  } else if (matchedAppt.rating) {
    // Cita ya calificada (tiene valor en rating), ignorar mensaje silenciosamente
    console.log(`[WhatsApp] ℹ️ Cita ${matchedAppt.id} ya calificada con ${matchedAppt.rating}⭐, ignorando mensaje`);
  }

  console.log(`[WhatsApp] ℹ️ Mensaje de ${matchedAppt.clientName} no activó ninguna acción (Estado: ${matchedAppt.status})`);
}

/**
 * Procesa la respuesta de un cliente para una cita específica
 * Usado cuando se encuentra la cita por código de referencia o por teléfono
 */
async function processAppointmentResponse(appt, text, msg, cleanIncomingPhone) {
  console.log(`[WhatsApp] 🔄 Procesando respuesta para cita ${appt.id.slice(0, 8)} | Estado: ${appt.status} | Ref: ${appt.referenceCode || 'N/A'}`);

  // 1. Lógica de Confirmación/Cancelación (para citas no terminadas)
  if (['pending', 'confirmed', 'attention'].includes(appt.status)) {
    // Palabras clave para confirmar - usar regex robusto igual que handleClientResponse
    // Regex flexible: SI o SÍ al inicio, permitiendo espacios y caracteres de puntuación después
    const isConfirm = /^(si|sí)[\s\.\,\!\?]*$/i.test(text) ||
                       /confirm|asistir[eé]|allá nos vemos|listo|^ok$|dale|perfecto/i.test(text);

    // Palabras clave para cancelar - usar regex robusto igual que handleClientResponse
    // Regex flexible: NO al inicio, permitiendo espacios y caracteres de puntuación después
    const isCancel = /^(no)[\s\.\,\!\?]*$/i.test(text) ||
                      /cancel|no puedo|no voy|no asistir[eé]|eliminar/i.test(text);

    if (isConfirm) {
      console.log(`[WhatsApp] ✅ Confirmando cita ${appt.id} (mensaje: "${msg.body}")`);
      try {
        await appt.update({
          status: 'confirmed',
          confirmed: true,
          confirmedAt: new Date(),
          messageFlowStatus: 'not_started' // Resetear flujo, esperará calificación después del servicio
        });
        console.log(`[WhatsApp] ✅ Cita ${appt.id} confirmada exitosamente en BD | messageFlowStatus: not_started`);

        const chat = await msg.getChat();
        await chat.sendStateTyping();
        setTimeout(async () => {
          try {
            await msg.reply(getRandomConfirmationTemplate());
            console.log(`[WhatsApp] ✅ Respuesta de confirmación enviada a cliente`);
          } catch (e) {
            console.error(`[WhatsApp] Error enviando respuesta confirmación:`, e.message);
          }
        }, 2000);
        return;
      } catch (confirmErr) {
        console.error(`[WhatsApp] ❌ Error actualizando cita en BD:`, confirmErr.message);
        return;
      }
    }

    if (isCancel) {
      console.log(`[WhatsApp] ❌ Cancelando cita ${appt.id} (mensaje: "${msg.body}")`);
      try {
        await appt.update({ 
          status: 'cancelled',
          messageFlowStatus: 'completed' // Flujo terminado
        });
        console.log(`[WhatsApp] ✅ Cita ${appt.id} cancelada exitosamente en BD | messageFlowStatus: completed`);

        const chat = await msg.getChat();
        await chat.sendStateTyping();
        setTimeout(async () => {
          try {
            const templates = [
              '✅ Cita cancelada exitosamente.',
              '👍 Confirmamos la cancelación. ¡Hasta pronto!',
              '📅 Cita cancelada. Escríbenos si necesitas reagendar.'
            ];
            await msg.reply(templates[Math.floor(Math.random() * templates.length)]);
          } catch (e) {
            console.error(`[WhatsApp] Error enviando respuesta cancelación:`, e.message);
          }
        }, 2000);
        return;
      } catch (cancelErr) {
        console.error(`[WhatsApp] ❌ Error cancelando cita en BD:`, cancelErr.message);
        return;
      }
    }

    // Si llegó aquí con cita activa, el mensaje no fue confirmación/cancelación válida
    console.log(`[WhatsApp] ℹ️ Mensaje no reconocido como confirmación/cancelación para cita activa`);
    return;
  }

  // 2. Lógica de Calificación (SOLO para citas terminadas o esperando calificación)
  // Condición consistente con handleClientResponse: awaiting_rating O done sin rating
  const canRate = (appt.messageFlowStatus === 'awaiting_rating') || 
                  (['done', 'attention'].includes(appt.status) && !appt.rating);
  
  if (canRate) {

    // Regex: solo números 1-5 solos
    const match = text.match(/^\s*([1-5])\s*$/);

    if (match) {
      const rating = parseInt(match[1]);
      console.log(`[WhatsApp] ⭐ Calificando cita ${appt.id} con ${rating} (mensaje: "${msg.body}")`);
      try {
        await appt.update({
          rating,
          ratingSent: true,
          status: 'done',
          messageFlowStatus: 'completed' // Flujo terminado, ya recibió calificación
        });
        console.log(`[WhatsApp] ✅ Calificación guardada en BD para cita ${appt.id} | messageFlowStatus: completed`);

        // Programar mensaje de agradecimiento extendido
        try {
          const { scheduleMessage } = require('./schedulerService');
          const thankYouTemplates = [
            `🙏 ¡Hola de nuevo *${appt.clientName}*! Queríamos agradecerte por tomarte el tiempo de calificar nuestro servicio. Tu opinión nos ayuda a mejorar cada día. ¡Te esperamos pronto! ✨`,
            `💫 *${appt.clientName}*, gracias por tu calificación. Valoramos mucho tu feedback y trabajamos constantemente para ofrecerte la mejor experiencia. ¡Hasta la próxima! 🌟`,
            `🎉 ¡Gracias *${appt.clientName}*! Tu calificación ha sido recibida. Nos motiva a seguir dando lo mejor. ¡Que tengas un excelente día! ☀️`
          ];
          const randomThankYou = thankYouTemplates[Math.floor(Math.random() * thankYouTemplates.length)];

          const thankYouTime = new Date(Date.now() + 60 * 1000);
          await scheduleMessage({
            businessId: appt.businessId,
            appointmentId: appt.id,
            phone: cleanIncomingPhone,
            message: randomThankYou,
            type: 'custom',
            scheduledAt: thankYouTime
          });

          await appt.update({
            thankYouMessageSent: true,
            thankYouMessageSentAt: thankYouTime
          });

          console.log(`[WhatsApp] 💚 Mensaje de agradecimiento programado en BD (1min) para cita ${appt.id}`);
        } catch (scheduleErr) {
          console.error(`[WhatsApp] Error programando agradecimiento:`, scheduleErr.message);
        }

        return;
      } catch (err) {
        console.error(`[WhatsApp] ❌ Error guardando calificación:`, err.message);
      }
    } else {
      console.log(`[WhatsApp] ℹ️ Mensaje no es calificación válida (formato: 1-5 solos)`);
    }
  } else if (appt.rating) {
    console.log(`[WhatsApp] ℹ️ Cita ${appt.id} ya calificada con ${appt.rating}⭐`);
  }

  console.log(`[WhatsApp] ℹ️ No se activó ninguna acción para cita ${appt.id.slice(0, 8)}`);
}

/**
 * Añade un mensaje a la cola global con delay
 */
async function queueMessage(businessId, to, text) {
  const resolvedId = await Business.resolveWhatsAppBusinessId(businessId);
  messageQueue.push({ businessId: resolvedId, to, text });
  if (!isProcessingQueue) processQueue();
}

async function processQueue() {
  if (messageQueue.length === 0) {
    isProcessingQueue = false;
    return;
  }

  // Verificar horario laboral - no enviar fuera de horario (7:00 AM - 8:00 PM Colombia)
  if (!isBusinessHours()) {
    const now = new Date();
    // Convertir UTC a hora Colombia para calcular cuándo es el próximo 7 AM Colombia
    const colombiaOffset = -5 * 60 * 60 * 1000; // UTC-5
    const colombiaTime = new Date(now.getTime() + colombiaOffset);
    const colombiaHour = colombiaTime.getUTCHours();

    // Calcular cuántos ms faltan para las 7:00 AM Colombia del día siguiente
    // 7:00 AM Colombia = 12:00 UTC
    const next7AMColombia = new Date(now);
    next7AMColombia.setUTCHours(12, 0, 0, 0); // 12:00 UTC = 7:00 AM Colombia

    // Si ya pasó las 8pm Colombia (1am UTC) o es antes de las 7am, ir al día siguiente
    if (colombiaHour >= 20 || colombiaHour < 7) {
      next7AMColombia.setUTCDate(next7AMColombia.getUTCDate() + 1);
    }

    const delayToMorning = next7AMColombia - now;
    const queueSize = messageQueue.length;
    console.log(`[WhatsApp] ⏰ Fuera de horario laboral Colombia (7am-8pm). ${queueSize} mensajes en cola. Reanudando a las 7am Colombia (${Math.round(delayToMorning / 60000)} min)`);

    // Los mensajes quedan guardados en la cola para el siguiente día
    setTimeout(processQueue, delayToMorning);
    return;
  }

  isProcessingQueue = true;
  const { businessId, to, text } = messageQueue.shift();

  // Verificar límite de mensajes por hora
  if (!canSendMessage(businessId)) {
    // Reencolar el mensaje para más tarde
    messageQueue.unshift({ businessId, to, text });
    console.log(`[WhatsApp] ⏳ Mensaje reencolado por límite de velocidad para ${businessId}`);
    setTimeout(processQueue, 60000); // Reintentar en 1 minuto
    return;
  }

  const client = instances.get(businessId);

  // Verificar si el cliente existe y está realmente LISTO (ready)
  const isReady = client && client.info && client.info.wid;

  if (isReady) {
    try {
      // Limpiar número y asegurar formato internacional (Colombia +57 por defecto si no tiene prefijo)
      let cleanTo = to.replace(/\D/g, '');
      if (cleanTo.length === 10) cleanTo = `57${cleanTo}`;

      const chatId = `${cleanTo}@c.us`;

      // Verificar si el número existe en WhatsApp para evitar el error "No LID"
      // Usamos un try-catch específico para isRegisteredUser porque falla internamente en la librería a veces
      let isRegistered = false;
      try {
        isRegistered = await client.isRegisteredUser(chatId);
      } catch (regErr) {
        console.warn(`[WhatsApp] ⚠️ Error al validar número ${cleanTo}:`, regErr.message);
        // Si falla por WidFactory, timeout o similar, asumimos que no podemos validar ahora y reencolamos
        if (regErr.message.includes('WidFactory') || regErr.message.includes('timeout') || regErr.message.includes('undefined')) {
          messageQueue.unshift({ businessId, to, text });
          console.log(`[WhatsApp] 🔄 Reencolando mensaje por error interno de validación`);
          setTimeout(processQueue, 30000);
          return;
        }
      }

      if (!isRegistered) {
        console.error(`[WhatsApp] ❌ El número ${cleanTo} no está registrado en WhatsApp`);
        // Pasamos al siguiente mensaje en el queue con un delay normal
        const nextDelay = getRandomDelay();
        setTimeout(processQueue, nextDelay);
        return;
      }

      // Simular "escribiendo..." antes de enviar (comportamiento humano)
      await simulateTyping(client, chatId, 2000 + Math.random() * 3000); // 2-5 segundos

      // Aplicar variaciones al mensaje
      const humanizedText = humanizeMessage(text);

      await client.sendMessage(chatId, humanizedText);
      console.log(`[WhatsApp] 📨 Mensaje enviado a ${cleanTo} (Negocio: ${businessId})`);
    } catch (e) {
      console.error(`[WhatsApp] ❌ Error enviando a ${to}:`, e.message);
      // Si el error es crítico (navegador cerrado, timeout de protocolo, etc), reencolamos y esperamos más tiempo
      if (e.message.includes('WidFactory') || e.message.includes('Protocol error') || e.message.includes('timeout')) {
        messageQueue.unshift({ businessId, to, text });
        console.log(`[WhatsApp] ⏳ Reencolando mensaje por error crítico de navegador`);
        setTimeout(processQueue, 60000);
        return;
      }
    }
  } else {
    // Cliente no está listo (modo bajo demanda - scheduler lo maneja)
    // En lugar de reencolar en memoria, usar scheduler para persistir en BD
    console.log(`[WhatsApp] ⏸️ Cliente ${businessId} no activo, enviando a scheduler para procesar en próximo ciclo...`);
    
    try {
      const { scheduleMessage } = require('./schedulerService');
      await scheduleMessage({
        businessId,
        phone: to,
        message: text,
        type: 'queue_fallback',
        scheduledAt: new Date(Date.now() + 5 * 60 * 1000) // 5 minutos (próximo ciclo del scheduler)
      });
      console.log(`[WhatsApp] 📅 Mensaje enviado a scheduler para procesar en próximo ciclo`);
    } catch (schedulerErr) {
      console.error(`[WhatsApp] ❌ Error enviando a scheduler:`, schedulerErr.message);
      // Solo como último recurso, reencolar con delay largo
      messageQueue.unshift({ businessId, to, text });
      setTimeout(processQueue, 5 * 60 * 1000); // 5 minutos
      return;
    }
    
    // Continuar con el siguiente mensaje en cola inmediatamente
    // (el scheduler manejará este mensaje más tarde)
    setTimeout(processQueue, 1000);
    return;
  }

  // Delay aleatorio entre 45 segundos y 3 minutos (comportamiento humano)
  // Para evitar bloqueos, agregamos variabilidad adicional basada en el tamaño de la cola
  const baseDelay = getRandomDelay();
  const queueSize = messageQueue.length;

  // Si hay muchos mensajes en cola, aumentamos el delay para espaciar más
  const additionalDelay = queueSize > 5 ? Math.random() * 60000 : 0; // Hasta 1 min extra si hay cola grande
  const nextDelay = baseDelay + additionalDelay;

  console.log(`[WhatsApp] ⏱️ Próximo mensaje en ${Math.round(nextDelay / 1000)} segundos (${queueSize} pendientes)`);
  setTimeout(processQueue, nextDelay);
}

/**
 * Fuerza un nuevo intento de conexión desde cero (para regenerar QR)
 */
async function forceReconnect(businessId) {
  const authPath = path.join(__dirname, `../../sessions/${businessId}`);

  // 1. Cerrar y eliminar la instancia actual
  const existingClient = instances.get(businessId);
  if (existingClient) {
    try {
      await existingClient.destroy();
    } catch (e) { }
    instances.delete(businessId);
  }

  // 2. Borrar archivos de sesión
  if (fs.existsSync(authPath)) {
    try {
      fs.rmSync(authPath, { recursive: true, force: true });
      console.log(`[WhatsApp] 🗑️ Sesión limpiada manualmente para ${businessId}`);
    } catch (e) {
      console.error(`[WhatsApp] Error limpiando sesión:`, e.message);
    }
  }

  // 3. Actualizar estado en BD
  await WhatsAppSession.update({ status: 'disconnected' }, { where: { businessId } });
  currentQRs.delete(businessId);

  // 4. Crear nueva instancia (generará QR fresco)
  console.log(`[WhatsApp] 🔄 Forzando nueva conexión para ${businessId}...`);
  await createInstance(businessId, true);
}

/**
 * Detiene una instancia sin borrar sus archivos de sesión
 */
async function stopInstance(businessId) {
  const client = instances.get(businessId);
  if (client) {
    try {
      await client.destroy();
    } catch (e) {
      console.warn(`[WhatsApp] ⚠️ Error al detener instancia:`, e.message);
    }
    instances.delete(businessId);
    currentQRs.delete(businessId);
    await WhatsAppSession.update({ status: 'disconnected' }, { where: { businessId } });
    console.log(`[WhatsApp] ⏸️ Instancia detenida para ${businessId} (archivos preservados)`);
    return true;
  }
  return false;
}

/**
 * Obtiene una instancia del mapa
 */
function getInstance(businessId) {
  return instances.get(businessId);
}

/**
 * Envía un mensaje directamente sin pasar por la cola.
 * Usado por el scheduler para enviar mensajes inmediatamente cuando tiene el cliente conectado.
 */
async function sendMessageDirect(businessId, to, text, retryCount = 0) {
  const resolvedId = await Business.resolveWhatsAppBusinessId(businessId);
  const client = instances.get(resolvedId);
  
  if (!client) {
    throw new Error('Cliente no está inicializado');
  }
  
  // Esperar a que el cliente esté listo (máximo 30 segundos)
  let attempts = 0;
  const maxAttempts = 30;
  
  while (!client.info || !client.info.wid) {
    if (attempts >= maxAttempts) {
      throw new Error('Timeout esperando cliente listo');
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
    attempts++;
  }
  
  // Formatear número - asegurar formato correcto para Colombia
  let cleanTo = to.replace(/\D/g, '');
  
  // Si el número no tiene prefijo de país, agregar 57 (Colombia)
  if (cleanTo.length === 10 && cleanTo.startsWith('3')) {
    cleanTo = '57' + cleanTo;
  }
  
  const chatId = `${cleanTo}@c.us`;
  
  try {
    console.log(`[WhatsApp] 📤 Intentando enviar a chatId: ${chatId}`);
    
    // Intentar obtener el chat (verifica que el número existe en WhatsApp)
    let chat;
    let chatExists = false;
    try {
      chat = await client.getChatById(chatId);
      chatExists = true;
      console.log(`[WhatsApp] ✅ Chat encontrado para ${cleanTo}`);
    } catch (chatError) {
      console.log(`[WhatsApp] ⚠️ Chat no encontrado para ${cleanTo}, intentando enviar directamente...`);
    }
    
    // Verificar si el número está registrado en WhatsApp
    try {
      const isRegistered = await client.isRegisteredUser(chatId);
      console.log(`[WhatsApp] 📋 Número ${cleanTo} registrado en WhatsApp: ${isRegistered}`);
      if (!isRegistered) {
        throw new Error(`El número ${cleanTo} no está registrado en WhatsApp`);
      }
    } catch (regError) {
      console.log(`[WhatsApp] ⚠️ Error verificando registro: ${regError.message}`);
      // Continuar de todos modos, a veces isRegisteredUser falla
    }
    
    // Simular "escribiendo..." solo si tenemos el chat
    if (chat) {
      try {
        await chat.sendStateTyping();
        await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 2000));
        await chat.clearState();
      } catch (typingError) {
        console.log(`[WhatsApp] ⚠️ Error en typing: ${typingError.message}`);
      }
    }
    
    // Enviar mensaje
    console.log(`[WhatsApp] 📨 Enviando mensaje a ${chatId}...`);
    const result = await client.sendMessage(chatId, text);
    console.log(`[WhatsApp] ✅ Mensaje enviado directamente a ${cleanTo} (Negocio: ${businessId})`);
    console.log(`[WhatsApp] 📄 Resultado:`, result ? `ID: ${result.id?._serialized || 'N/A'}` : 'Sin ID');
    
    // Verificar que el mensaje realmente se envió esperando y chequeando el chat
    if (result && result.id) {
      console.log(`[WhatsApp] ⏳ Esperando confirmación de sincronización (3s)...`);
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      try {
        // Intentar obtener el mensaje para verificar que existe
        const chat = await client.getChatById(chatId);
        const messages = await chat.fetchMessages({ limit: 5 });
        const foundMsg = messages.find(m => m.id._serialized === result.id._serialized);
        
        if (foundMsg) {
          console.log(`[WhatsApp] ✅ Mensaje verificado en chat: ${foundMsg.id._serialized}`);
          console.log(`[WhatsApp] 📊 Estado del mensaje: ack=${foundMsg.ack} (0=pending, 1=server, 2=device, 3=read, 4=played)`);
        } else {
          console.warn(`[WhatsApp] ⚠️ Mensaje no encontrado en el chat después de enviar`);
        }
      } catch (verifyError) {
        console.log(`[WhatsApp] ⚠️ No se pudo verificar el mensaje: ${verifyError.message}`);
      }
    }
    
    return true;
  } catch (error) {
    // Si es error de "No LID for user" y no hemos reintentado, esperar y reintentar
    if (error.message && error.message.includes('No LID for user') && retryCount < 2) {
      console.log(`[WhatsApp] ⚠️ Error 'No LID for user', esperando 5s y reintentando (${retryCount + 1}/2)...`);
      await new Promise(resolve => setTimeout(resolve, 5000));
      return sendMessageDirect(businessId, to, text, retryCount + 1);
    }
    
    // Si el error indica que el número no está en WhatsApp
    if (error.message && (error.message.includes('No LID for user') || error.message.includes('not registered'))) {
      throw new Error(`El número ${cleanTo} no tiene WhatsApp o no está registrado`);
    }
    
    throw error;
  }
}

module.exports = { initWhatsAppManager, createInstance, stopInstance, queueMessage, sendMessageDirect, currentQRs, forceReconnect, instances, getInstance, getRandomConfirmationTemplate, getRandomReminderTemplate, getRandomRatingTemplate, getRandomDelay, isBusinessHours, hasValidSession };