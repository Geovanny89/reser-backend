const admin = require('firebase-admin');

// Inicializar Firebase Admin con las credenciales del servicio
let firebaseInitialized = false;

try {
  // Verificar si hay credenciales en variable de entorno
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    // Usar credenciales desde variable de entorno (para producción)
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    
    firebaseInitialized = true;
    console.log('[FCM] ✅ Firebase Admin inicializado desde variable de entorno');
  } else {
    // Intentar cargar desde archivo local (desarrollo local)
    try {
      const serviceAccount = require('../config/firebase-service-account.json');
      
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      
      firebaseInitialized = true;
      console.log('[FCM] ✅ Firebase Admin inicializado desde archivo local');
    } catch (fileError) {
      console.warn('[FCM] ⚠️  No se encontró archivo de credenciales locales');
    }
  }
} catch (error) {
  console.warn('[FCM] ⚠️  Error inicializando Firebase Admin:', error.message);
  console.warn('[FCM] Las notificaciones push no funcionarán sin credenciales válidas');
}

/**
 * Envía una notificación push a un dispositivo específico
 * @param {string} fcmToken - Token FCM del dispositivo
 * @param {Object} notification - Objeto con title, body
 * @param {Object} data - Datos adicionales (opcional)
 */
const sendPushNotification = async (fcmToken, notification, data = {}) => {
  if (!firebaseInitialized) {
    console.log('[FCM] Simulando envío de notificación (Firebase no inicializado)');
    return { simulated: true, fcmToken, notification };
  }

  if (!fcmToken) {
    console.log('[FCM] No se envió notificación: fcmToken no proporcionado');
    return { error: 'No FCM token provided' };
  }

  try {
    const message = {
      token: fcmToken,
      notification: {
        title: notification.title,
        body: notification.body,
      },
      data: {
        ...data,
        click_action: 'FLUTTER_NOTIFICATION_CLICK', // Para apps Flutter/Capacitor
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'appointment_notifications',
          sound: 'default',
          vibrateTimings: ['0s', '0.5s', '0.5s'],
          priority: 'high',
        },
      },
    };

    const response = await admin.messaging().send(message);
    console.log('[FCM] ✅ Notificación enviada:', response);
    return { success: true, messageId: response };
  } catch (error) {
    console.error('[FCM] ❌ Error enviando notificación:', error.message);
    
    // Si el token es inválido/expirado, informar para limpiarlo
    if (error.code === 'messaging/registration-token-not-registered') {
      return { error: 'Invalid token', shouldRemove: true };
    }
    
    return { error: error.message };
  }
};

/**
 * Envía notificación de cancelación al negocio
 * @param {string} fcmToken - Token del dueño/empleado
 * @param {Object} appointmentData - Datos de la cita cancelada
 */
const sendCancellationNotification = async (fcmToken, appointmentData) => {
  const { clientName, serviceName, businessName, startTime } = appointmentData;
  
  return sendPushNotification(
    fcmToken,
    {
      title: '❌ Cita Cancelada',
      body: `${clientName} canceló su cita de ${serviceName} para ${new Date(startTime).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Bogota' })}`,
    },
    {
      type: 'appointment_cancelled',
      appointmentId: appointmentData.id,
      businessName: businessName || '',
    }
  );
};

/**
 * Envía notificación a múltiples dispositivos
 * @param {Array<string>} fcmTokens - Array de tokens
 * @param {Object} notification - Objeto con title, body
 * @param {Object} data - Datos adicionales
 */
const sendMulticastNotification = async (fcmTokens, notification, data = {}) => {
  if (!firebaseInitialized || !fcmTokens || fcmTokens.length === 0) {
    return { error: 'Firebase no inicializado o sin tokens' };
  }

  try {
    const message = {
      tokens: fcmTokens,
      notification: {
        title: notification.title,
        body: notification.body,
      },
      data,
      android: {
        priority: 'high',
        notification: {
          channelId: 'appointment_notifications',
          sound: 'default',
          vibrateTimings: ['0s', '0.5s', '0.5s'],
          priority: 'high',
        },
      },
    };

    const response = await admin.messaging().sendEachForMulticast(message);
    console.log(`[FCM] Multicast: ${response.successCount} exitosas, ${response.failureCount} fallidas`);
    return {
      success: true,
      successCount: response.successCount,
      failureCount: response.failureCount,
      failedTokens: response.responses
        .map((resp, idx) => ({ resp, idx }))
        .filter(({ resp }) => !resp.success)
        .map(({ idx }) => fcmTokens[idx]),
    };
  } catch (error) {
    console.error('[FCM] ❌ Error en multicast:', error.message);
    return { error: error.message };
  }
};

module.exports = {
  sendPushNotification,
  sendCancellationNotification,
  sendMulticastNotification,
  isInitialized: () => firebaseInitialized,
};
