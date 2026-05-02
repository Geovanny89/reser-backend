const { ClientProfile, BirthdayTemplate, Business, WhatsAppSession } = require('../models');
const { Op } = require('sequelize');
const { scheduleMessage } = require('./schedulerService');
const { getRandomTemplate } = require('./reminder/message.generators');

/**
 * Servicio de felicitaciones de cumpleaños automáticas
 */

// Intervalo de revisión (cada 1 hora para mayor seguridad, aunque se envía una vez al día)
const CHECK_INTERVAL_MS = 60 * 60 * 1000; 
let intervalId = null;

/**
 * Función principal para procesar cumpleaños del día
 */
async function processBirthdays() {
  console.log('[BirthdayService] 🎂 Iniciando escaneo diario de cumpleaños...');
  
  try {
    const now = new Date();
    // Ajuste a Colombia (UTC-5)
    const colombiaTime = new Date(now.getTime() - (5 * 60 * 60 * 1000));
    const currentMonth = colombiaTime.getUTCMonth() + 1;
    const currentDay = colombiaTime.getUTCDate();
    const currentYear = colombiaTime.getUTCFullYear();

    console.log(`[BirthdayService] 📅 Fecha actual (COL): ${currentDay}/${currentMonth}/${currentYear}`);

    // 1. Obtener todos los perfiles de clientes que cumplen años hoy 
    // y que NO hayan recibido saludo este año
    const clients = await ClientProfile.findAll({
      where: {
        birthday: { [Op.ne]: null },
        [Op.or]: [
          { lastSentBirthdayYear: { [Op.lt]: currentYear } },
          { lastSentBirthdayYear: null }
        ]
      }
    });

    // Filtrar manualmente por mes/día (Sequelize DATEONLY a veces es caprichoso con funciones de DB)
    const birthdayClients = clients.filter(client => {
      const bday = new Date(client.birthday);
      // Las fechas DATEONLY se cargan como UTC 00:00:00
      return (bday.getUTCMonth() + 1) === currentMonth && bday.getUTCDate() === currentDay;
    });

    console.log(`[BirthdayService] 🔍 Encontrados ${birthdayClients.length} cumpleañeros para hoy.`);

    for (const client of birthdayClients) {
      await sendBirthdayGreeting(client, currentYear);
    }

    console.log('[BirthdayService] ✅ Escaneo de cumpleaños finalizado.');
  } catch (error) {
    console.error('[BirthdayService] ❌ Error procesando cumpleaños:', error);
  }
}

/**
 * Envía la felicitación a un cliente específico
 */
async function sendBirthdayGreeting(client, year) {
  try {
    // 1. Obtener plantillas activas del negocio
    const templates = await BirthdayTemplate.findAll({
      where: { 
        businessId: client.businessId,
        isActive: true 
      }
    });

    if (templates.length === 0) {
      console.log(`[BirthdayService] ℹ️ Negocio ${client.businessId} no tiene plantillas de cumpleaños activas.`);
      return;
    }

    // 2. Elegir una plantilla al azar
    const selectedTemplate = templates[Math.floor(Math.random() * templates.length)];
    let message = selectedTemplate.content;

    // 3. Reemplazar variables básicas (puedes añadir más)
    // Asumimos que tenemos acceso al nombre del cliente vía Appointment o similar, 
    // pero si no, intentamos obtenerlo de algún lado o usamos un genérico.
    // NOTA: ClientProfile no tiene 'name' directamente en este modelo, 
    // pero usualmente está en la tabla User o se puede inferir de citas previas.
    // Por ahora usaremos el mensaje tal cual o con Spintax.
    
    // 4. Aplicar Spintax y Fingerprint (Anti-Baneo)
    // getRandomTemplate ya aplica el blindaje si le pasamos un array
    const finalMessage = getRandomTemplate([message]);

    // 5. Programar el mensaje
    if (client.clientPhone) {
      await scheduleMessage({
        businessId: client.businessId,
        phone: client.clientPhone,
        message: finalMessage,
        type: 'birthday',
        scheduledAt: new Date() // Enviar de inmediato (el scheduler respetará el horario laboral)
      });

      // 6. Marcar como enviado este año
      await client.update({ lastSentBirthdayYear: year });
      console.log(`[BirthdayService] 🎉 Saludo programado para ${client.clientPhone} (Negocio: ${client.businessId})`);
    }

  } catch (error) {
    console.error(`[BirthdayService] ❌ Error enviando saludo a cliente ${client.id}:`, error.message);
  }
}

/**
 * Inicia el servicio
 */
function startBirthdayService() {
  if (intervalId) return;
  
  console.log('[BirthdayService] 🚀 Servicio de cumpleaños iniciado.');
  
  // Ejecutar una vez al arrancar
  processBirthdays();
  
  // Revisar cada hora (por si hay nuevos clientes o reinicios)
  intervalId = setInterval(processBirthdays, CHECK_INTERVAL_MS);
}

/**
 * Detiene el servicio
 */
function stopBirthdayService() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log('[BirthdayService] 🛑 Servicio de cumpleaños detenido.');
  }
}

module.exports = {
  startBirthdayService,
  stopBirthdayService,
  processBirthdays
};
