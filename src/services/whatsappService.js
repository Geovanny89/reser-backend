const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode-svg');
const { WhatsAppSession, Appointment, Business, User, Service, Employee } = require('../models');
const { sendEmail } = require('../config/email');
const { sendCancellationNotification } = require('./pushNotificationService');
const path = require('path');
const fs = require('fs');

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

/**
 * Genera un delay aleatorio entre mensajes para simular comportamiento humano
 * Entre 45 segundos y 3 minutos
 */
function getRandomDelay() {
  return Math.floor(Math.random() * (180000 - 60000 + 1)) + 60000; // 60 segundos a 3 minutos
}

/**
 * Verifica si es horario laboral (7am - 8pm Colombia)
 * WhatsApp puede bloquear números que envían fuera de horarios normales
 */
function isBusinessHours() {
  const now = new Date();
  const hour = now.getHours();
  return hour >= 7 && hour < 20; // 7am - 8pm
}

/**
 * Verifica si el negocio puede enviar más mensajes esta hora
 */
function canSendMessage(businessId) {
  const now = new Date();
  const currentHour = now.getHours();
  
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
 * Inicializa el gestor de WhatsApp para todos los negocios que tengan sesión
 */
async function initWhatsAppManager() {
  console.log('[WhatsApp] 🚀 Iniciando gestor de instancias...');
  try {
    const sessions = await WhatsAppSession.findAll();
    for (const session of sessions) {
      if (session.status === 'connected') {
        try {
          await createInstance(session.businessId);
        } catch (err) {
          console.error(`[WhatsApp] ❌ Error inicializando sesión para ${session.businessId}:`, err.message);
        }
      }
    }
  } catch (err) {
    console.error('[WhatsApp] ❌ Error crítico en initWhatsAppManager:', err.message);
  }
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
        } catch (e) {}
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
        } catch (e) {}
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
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ],
      executablePath: process.env.CHROME_PATH || undefined
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
      } catch (e) {}
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
      } catch (e) {}

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
          try { fs.rmSync(authPath, { recursive: true, force: true }); } catch (e) {}
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
  const activeAppts = await Appointment.findAll({
    where: { 
      businessId: { [require('sequelize').Op.in]: businessIds },
      status: { [require('sequelize').Op.in]: ['pending', 'confirmed', 'attention'] }
    },
    order: [['startTime', 'ASC']]
  });

  const doneAppts = await Appointment.findAll({
    where: { 
      businessId: { [require('sequelize').Op.in]: businessIds },
      status: 'done',
      rating: null // Solo citas SIN calificar aún
    },
    order: [['startTime', 'DESC']] // Las más recientes primero
  });

  // Combinar: primero activas, luego done (para dar prioridad a confirmación sobre calificación)
  const recentAppts = [...activeAppts, ...doneAppts];

  console.log(`[WhatsApp] 🔍 Buscando en ${recentAppts.length} citas (${activeAppts.length} activas, ${doneAppts.length} sin calificar) de ${businessIds.length} negocios vinculados`);
  
  // LOG CRÍTICO PARA DEPURACIÓN: Ver qué citas se están comparando
  recentAppts.forEach(a => {
    const dbPhone = String(a.clientPhone || '').replace(/\D/g, '');
    console.log(`   -> Cita ${a.id.slice(0,8)} | Tel DB: ${dbPhone} | Status: ${a.status}`);
  });

  // 3. Filtrar por teléfono con lógica ultra-flexible
  const matchedAppt = recentAppts.find(appt => {
    if (!appt.clientPhone) return false;
    
    const dbPhone = String(appt.clientPhone).replace(/\D/g, '');
    let dbPhoneLast10 = dbPhone.slice(-10);
    
    // Normalizar número de DB si empieza con 0 (convertir a formato 3xx)
    if (dbPhoneLast10.length === 10 && dbPhoneLast10.startsWith('0')) {
      dbPhoneLast10 = '3' + dbPhoneLast10.substring(1);
    }
    
    // A. Coincidencia exacta de últimos 10 dígitos (el caso más común)
    if (dbPhoneLast10 === cleanIncomingPhone) {
      console.log(`[WhatsApp] ✅ Match exacto: DB ${dbPhoneLast10} === Incoming ${cleanIncomingPhone}`);
      return true;
    }
    
    // B. El teléfono de la DB está contenido en el ID largo de WhatsApp
    if (from.includes(dbPhoneLast10) && dbPhoneLast10.length >= 7) {
      console.log(`[WhatsApp] ✅ Match por contención en ID: ${dbPhoneLast10} en ${from}`);
      return true;
    }
    
    // C. El ID de WhatsApp termina en el teléfono de la DB
    if (from.endsWith(dbPhone)) {
      console.log(`[WhatsApp] ✅ Match por terminación: ${from} termina en ${dbPhone}`);
      return true;
    }
    
    // D. Comparar sin el prefijo 57 de Colombia
    if (dbPhone.startsWith('57')) {
      const dbNoPrefix = dbPhone.substring(2);
      if (dbNoPrefix === cleanIncomingPhone || dbNoPrefix.slice(-10) === cleanIncomingPhone) {
        console.log(`[WhatsApp] ✅ Match sin prefijo 57: ${dbNoPrefix} === ${cleanIncomingPhone}`);
        return true;
      }
    }
    
    // E. Match parcial de últimos 7 dígitos (para números similares con prefijos diferentes)
    // Esto ayuda cuando el usuario tiene variaciones en su número (ej: 311... vs 350...)
    const dbPhoneLast7 = dbPhoneLast10.slice(-7);
    const incomingLast7 = cleanIncomingPhone.slice(-7);
    if (dbPhoneLast7 === incomingLast7 && dbPhoneLast7.length >= 7) {
      console.log(`[WhatsApp] ⚠️ Match parcial (últimos 7 dígitos): ${dbPhoneLast10} ~ ${cleanIncomingPhone}`);
      return true;
    }

    return false;
  });

  if (!matchedAppt) {
    console.log(`[WhatsApp] 🔍 Sin coincidencias para tel: ${cleanIncomingPhone} (ID: ${from}) en BIZ: ${businessId}`);
    return;
  }

  console.log(`[WhatsApp] 📍 Cita encontrada ID:${matchedAppt.id} Estado:${matchedAppt.status} Cliente:${matchedAppt.clientName}`);

  // 4. Lógica de Confirmación/Cancelación (para citas no terminadas)
  if (['pending', 'confirmed', 'attention'].includes(matchedAppt.status)) {
    // Extraer el primer dígito del mensaje (ignorando espacios, puntuación, emojis)
    const firstDigitMatch = text.match(/^\s*([12])\b/);
    const firstDigit = firstDigitMatch ? firstDigitMatch[1] : null;
    
    const isConfirm = firstDigit === '1' || text.includes('si') || text.includes('confirm') || text.includes('sí');
    const isCancel = firstDigit === '2' || text.includes('no') || text.includes('cancel') || text.includes('cancelar');

    if (isConfirm) {
      console.log(`[WhatsApp] ✅ Confirmando cita ${matchedAppt.id}`);
      await matchedAppt.update({ 
        status: 'confirmed', 
        confirmed: true, 
        confirmedAt: new Date() 
      });
      
      const chat = await msg.getChat();
      await chat.sendStateTyping();
      setTimeout(async () => {
        try {
          await msg.reply(getRandomConfirmationTemplate());
        } catch (e) { console.error(`[WhatsApp] Error respuesta:`, e.message); }
      }, 50000); // 50 segundos
      return;
    } 
    
    if (isCancel) {
      console.log(`[WhatsApp] ❌ Cancelando cita ${matchedAppt.id}`);
      await matchedAppt.update({ status: 'cancelled' });
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
        } catch (e) { console.error(`[WhatsApp] Error respuesta:`, e.message); }
      }, 50000); // 50 segundos
      return;
    }
  }

  // 5. Lógica de Calificación (para citas terminadas o que acaban de terminar)
  if (['done', 'attention'].includes(matchedAppt.status) && !matchedAppt.rating) {
    const match = text.match(/[1-5]/);
    if (match) {
      const rating = parseInt(match[0]);
      console.log(`[WhatsApp] ⭐ Calificando cita ${matchedAppt.id} con ${rating}`);
      try {
        await matchedAppt.update({ 
          rating,
          status: 'done' // Asegurar que pase a terminada si aún no lo estaba
        });
        
        // Respuesta inmediata de agradecimiento
        await msg.reply(`🌟 ¡Gracias por calificar con ${'⭐'.repeat(rating)}! Nos ayuda mucho.`);
        
        // Programar mensaje de agradecimiento extendido para 1 hora después
        setTimeout(async () => {
          try {
            const thankYouTemplates = [
              `🙏 ¡Hola de nuevo *${matchedAppt.clientName}*! Queríamos agradecerte por tomarte el tiempo de calificar nuestro servicio. Tu opinión nos ayuda a mejorar cada día. ¡Te esperamos pronto! ✨`,
              `💫 *${matchedAppt.clientName}*, gracias por tu calificación. Valoramos mucho tu feedback y trabajamos constantemente para ofrecerte la mejor experiencia. ¡Hasta la próxima! 🌟`,
              `🎉 ¡Gracias *${matchedAppt.clientName}*! Tu calificación ha sido recibida. Nos motiva a seguir dando lo mejor. ¡Que tengas un excelente día! ☀️`
            ];
            const randomThankYou = thankYouTemplates[Math.floor(Math.random() * thankYouTemplates.length)];
            await queueMessage(matchedAppt.businessId, cleanIncomingPhone, randomThankYou);
            console.log(`[WhatsApp] 🙏 Mensaje de agradecimiento enviado 1h post-calificación para cita ${matchedAppt.id}`);
          } catch (thankErr) {
            console.error(`[WhatsApp] Error enviando agradecimiento post-calificación:`, thankErr.message);
          }
        }, 60 * 60 * 1000); // 1 hora
        
        return;
      } catch (err) {
        console.error(`[WhatsApp] Error guardando calificación:`, err.message);
      }
    }
  }

  console.log(`[WhatsApp] ℹ️ Mensaje de ${matchedAppt.clientName} no activó ninguna acción (Estado: ${matchedAppt.status})`);
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

  // Verificar horario laboral - no enviar fuera de horario (7am - 8pm)
  if (!isBusinessHours()) {
    const now = new Date();
    const nextHour = new Date(now);
    nextHour.setHours(7, 0, 0, 0); // Próximo día a las 7am
    
    // Si ya pasó las 8pm, programar para mañana a las 7am
    if (now.getHours() >= 20 || now.getHours() < 7) {
      nextHour.setDate(nextHour.getDate() + 1);
    }
    
    const delayToMorning = nextHour - now;
    const queueSize = messageQueue.length;
    console.log(`[WhatsApp] ⏰ Fuera de horario laboral (7am-8pm). ${queueSize} mensajes en cola. Reanudando mañana a las 7am (${Math.round(delayToMorning/60000)} min)`);
    
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
    console.error(`[WhatsApp] ❌ Cliente no listo para ${businessId}. Reencolando...`);
    messageQueue.unshift({ businessId, to, text });
    // Si no está listo, esperamos un poco más para que inicialice
    setTimeout(processQueue, 15000);
    return;
  }

  // Delay aleatorio entre 45 segundos y 3 minutos (comportamiento humano)
  // Para evitar bloqueos, agregamos variabilidad adicional basada en el tamaño de la cola
  const baseDelay = getRandomDelay();
  const queueSize = messageQueue.length;
  
  // Si hay muchos mensajes en cola, aumentamos el delay para espaciar más
  const additionalDelay = queueSize > 5 ? Math.random() * 60000 : 0; // Hasta 1 min extra si hay cola grande
  const nextDelay = baseDelay + additionalDelay;
  
  console.log(`[WhatsApp] ⏱️ Próximo mensaje en ${Math.round(nextDelay/1000)} segundos (${queueSize} pendientes)`);
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
    } catch (e) {}
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

module.exports = { initWhatsAppManager, createInstance, stopInstance, queueMessage, currentQRs, forceReconnect, instances, getInstance, getRandomConfirmationTemplate, getRandomReminderTemplate, getRandomRatingTemplate, getRandomDelay, isBusinessHours };