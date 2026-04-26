const router = require('express').Router();
const auth = require('../middleware/auth');
const role = require('../middleware/role');
const whatsappService = require('../services/evolutionService');
const models = require('../models');
const notificationController = require('../controllers/notification.controller');

// Ruta para obtener o generar QR de WhatsApp
router.get('/whatsapp/qr', auth, async (req, res) => {
  try {
    const businessId = req.query.businessId;
    if (!businessId) return res.status(400).json({ error: 'businessId es requerido' });

    console.log(`[WhatsApp Route] 🚀 Solicitud de QR para BusinessID: ${businessId}`);

    // Verificar si ya está conectado
    const session = await models.WhatsAppSession.findOne({ where: { businessId } });
    if (session?.status === 'connected') {
      return res.json({ status: 'connected' });
    }

    // Si ya tenemos un QR en memoria, enviarlo de inmediato
    if (whatsappService.currentQRs.has(businessId)) {
      console.log(`[WhatsApp Route] 🔄 Entregando QR desde memoria para ${businessId}`);
      return res.json({ qr: whatsappService.currentQRs.get(businessId), status: 'connecting' });
    }

    // Intentar inicializar o recuperar instancia
    // Quitamos forceFresh por defecto para no borrar sesiones existentes por error
    await whatsappService.createInstance(businessId, false);

    // Esperar un poco a que se genere el QR (el evento 'qr' en whatsappService lo guardará en currentQRs)
    let attempts = 0;
    const maxAttempts = 30; // Aumentar a 30 segundos para dar tiempo a Puppeteer
    
    const waitForQR = setInterval(() => {
      attempts++;
      const qrData = whatsappService.currentQRs.get(businessId);
      
      if (qrData) {
        clearInterval(waitForQR);
        console.log(`[WhatsApp Route] ✅ QR encontrado y enviado para ${businessId} en intento ${attempts}`);
        return res.json({ qr: qrData, status: 'connecting' });
      }
      
      if (attempts >= maxAttempts) {
        clearInterval(waitForQR);
        console.log(`[WhatsApp Route] ❌ Tiempo de espera agotado para QR de ${businessId}`);
        
        // Verificar si por casualidad ya se conectó (compatible con Evolution API)
        const instance = whatsappService.instances.get(businessId);
        if (instance && (instance.status === 'open' || instance.status === 'connected')) {
           return res.json({ status: 'connected' });
        } else {
           return res.status(408).json({ error: 'No se pudo generar el código QR a tiempo. Por favor, intenta de nuevo.' });
        }
      }
    }, 1000);

  } catch (e) {
    console.error('[WhatsApp Route Error]:', e);
    res.status(500).json({ error: 'Error al inicializar WhatsApp: ' + e.message });
  }
});

// Ruta para ver estado de la conexión
router.get('/whatsapp/status', auth, async (req, res) => {
  try {
    const { businessId } = req.query;
    if (!businessId) {
      return res.status(400).json({ error: 'businessId es requerido' });
    }
    
    const session = await models.WhatsAppSession.findOne({ where: { businessId } });
    
    // Si en la DB dice conectado, verificar si la instancia realmente existe y está viva
    let actualStatus = session?.status || 'disconnected';
    
    if (actualStatus === 'connected') {
      // Usar getInstance con fallback de seguridad
      const client = whatsappService.getInstance ? whatsappService.getInstance(businessId) : null;
      if (!client) {
        // Chrome no está corriendo, pero puede haber sesión guardada
        actualStatus = 'disconnected';
        // Verificar si hay sesión guardada en disco
        if (whatsappService.hasValidSession && whatsappService.hasValidSession(businessId)) {
          actualStatus = 'session_saved';
          // Actualizar BD
          await models.WhatsAppSession.update({ status: 'session_saved' }, { where: { businessId } });
        } else {
          // No hay sesión válida
          await models.WhatsAppSession.update({ status: 'disconnected' }, { where: { businessId } });
        }
      }
    } else if (actualStatus === 'disconnected' || !session) {
      // Verificar si hay sesión guardada en disco que no está reflejada en BD
      if (whatsappService.hasValidSession && whatsappService.hasValidSession(businessId)) {
        actualStatus = 'session_saved';
        // Verificar que el negocio existe antes de crear/actualizar registro en BD
        const businessExists = await models.Business.findByPk(businessId);
        if (businessExists) {
          await models.WhatsAppSession.upsert({
            businessId,
            status: 'session_saved',
            lastActivity: new Date()
          });
        } else {
          console.log(`⚠️ No se puede guardar sesión WhatsApp: negocio ${businessId} no existe`);
        }
      }
    }

    res.json({
      status: actualStatus,
      phoneNumber: session?.phoneNumber || null,
      lastActivity: session?.lastActivity || null
    });
  } catch (e) {
    console.error('[WhatsApp Status Route Error]:', e);
    res.status(500).json({ error: e.message });
  }
});

// Ruta para reiniciar el servicio (limpiar sesión y empezar de cero)
router.post('/whatsapp/reset', auth, async (req, res) => {
  try {
    const { businessId } = req.query;
    if (!businessId) return res.status(400).json({ error: 'businessId es requerido' });
    
    console.log(`[WhatsApp Route] 🔄 Reiniciando servicio para ${businessId}...`);
    await whatsappService.createInstance(businessId, true); // forceFresh = true
    res.json({ message: 'Servicio reiniciado. Generando nuevo QR...' });
  } catch (e) {
    console.error('[WhatsApp Reset Error]:', e);
    res.status(500).json({ error: e.message });
  }
});

// Ruta para conectar rápidamente (sin QR) cuando hay sesión guardada
router.post('/whatsapp/connect', auth, async (req, res) => {
  try {
    const { businessId } = req.query;
    if (!businessId) return res.status(400).json({ error: 'businessId es requerido' });
    
    const session = await models.WhatsAppSession.findOne({ where: { businessId } });
    
    // Si ya está conectado, no hacer nada
    if (session?.status === 'connected') {
      return res.json({ status: 'connected', message: 'WhatsApp ya está conectado' });
    }
    
    // Si hay sesión guardada, intentar conectar sin QR
    if (session?.status === 'session_saved') {
      console.log(`[WhatsApp Route] ⚡ Conectando rápidamente para ${businessId} (sesión guardada)...`);
      try {
        await whatsappService.createInstance(businessId, false); // forceFresh = false
        return res.json({ status: 'connected', message: 'WhatsApp conectado exitosamente' });
      } catch (err) {
        console.error(`[WhatsApp Route] ❌ Error conectando:`, err.message);
        // Si falla, marcar como desconectado y requerir QR
        await models.WhatsAppSession.update({ status: 'disconnected' }, { where: { businessId } });
        return res.status(400).json({ 
          status: 'disconnected', 
          error: 'No se pudo restaurar la sesión. Por favor escanea el QR nuevamente.',
          requiresQR: true 
        });
      }
    }
    
    // Si no hay sesión, requerir QR
    res.status(400).json({ 
      status: 'disconnected', 
      error: 'No hay sesión guardada. Por favor escanea el QR para vincular.',
      requiresQR: true 
    });
  } catch (e) {
    console.error('[WhatsApp Connect Error]:', e);
    res.status(500).json({ error: e.message });
  }
});

// Ruta para detener el servicio (pausar)
router.post('/whatsapp/stop', auth, async (req, res) => {
  try {
    const { businessId } = req.query;
    if (!businessId) return res.status(400).json({ error: 'businessId es requerido' });
    
    const client = whatsappService.instances.get(businessId);
    if (client) {
      await client.destroy();
      whatsappService.instances.delete(businessId);
    }
    await models.WhatsAppSession.update({ status: 'disconnected' }, { where: { businessId } });
    
    res.json({ message: 'Servicio de WhatsApp pausado.' });
  } catch (e) {
    console.error('[WhatsApp Stop Error]:', e);
    res.status(500).json({ error: e.message });
  }
});

// Ruta para cerrar sesión completamente
router.post('/whatsapp/logout', auth, async (req, res) => {
  try {
    const { businessId } = req.query;
    if (!businessId) return res.status(400).json({ error: 'businessId es requerido' });
    
    const client = whatsappService.instances.get(businessId);
    if (client) {
      try { await client.logout(); } catch (e) {}
      try { await client.destroy(); } catch (e) {}
      whatsappService.instances.delete(businessId);
    }
    whatsappService.currentQRs.delete(businessId);
    await models.WhatsAppSession.destroy({ where: { businessId } });
    
    // Borrar carpeta de sesión
    const sessionsDir = require('path').resolve(__dirname, '../../sessions');
    const authPath = require('path').join(sessionsDir, `session-${businessId}`);
    if (require('fs').existsSync(authPath)) {
      require('fs').rmSync(authPath, { recursive: true, force: true });
    }

    res.json({ message: 'Sesión cerrada y archivos eliminados.' });
  } catch (e) {
    console.error('[WhatsApp Logout Error]:', e);
    res.status(500).json({ error: e.message });
  }
});

// Ruta para enviar resumen de pagos a empleado
router.post('/payment-summary', auth, role('admin', 'admin_suc', 'superadmin'), notificationController.sendPaymentSummary);

// Ruta de prueba para webhook
router.get('/evolution/webhook/test', async (req, res) => {
  console.log('[Evolution Webhook] 🧪 Test endpoint accedido');
  res.json({ message: 'Webhook endpoint is accessible', timestamp: new Date() });
});

// Ruta para configurar webhook manualmente en una instancia
router.post('/evolution/configure-webhook', async (req, res) => {
  try {
    const { businessId } = req.body;
    if (!businessId) {
      return res.status(400).json({ error: 'businessId es requerido' });
    }

    const { configureWebhook } = require('../services/evolution/instanceManager');
    await configureWebhook(businessId);
    
    res.json({ message: 'Webhook configurado exitosamente', businessId });
  } catch (e) {
    console.error('[Evolution Webhook] ❌ Error configurando webhook:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Ruta para recibir webhooks de Evolution API
router.post('/evolution/webhook', async (req, res) => {
  try {
    console.log('[Evolution Webhook] 📨 Webhook recibido:', JSON.stringify(req.body).substring(0, 500));
    
    const { event, data, instance } = req.body;
    
    if (!instance) {
      console.log('[Evolution Webhook] ⚠️ Webhook sin instancia, ignorando');
      return res.status(200).json({ message: 'OK' });
    }
    
    const businessId = instance;
    
    // Manejar evento de conexión
    if (event === 'connection.update' || event === 'connection_update') {
      const connectionState = data?.state || data?.connectionState;
      console.log(`[Evolution Webhook] 🔌 Estado de conexión para ${businessId}: ${connectionState}`);
      
      if (connectionState === 'open' || connectionState === 'connected') {
        console.log(`[Evolution Webhook] ✅ Instancia ${businessId} conectada, guardando sesión...`);
        
        // IMPORTANTE: Actualizar estado en memoria para que hasValidSession funcione
        const { setInstance } = require('../services/evolution/state');
        setInstance(businessId, {
          instanceName: businessId,
          status: 'connected',
          createdAt: new Date()
        });
        console.log(`[Evolution Webhook] 💾 Estado guardado en memoria para ${businessId}: connected`);
        
        // Obtener información de la instancia
        try {
          const instanceInfo = await whatsappService.getInstanceInfo(businessId);
          
          if (instanceInfo) {
            // Crear o actualizar sesión en BD
            await models.WhatsAppSession.upsert({
              businessId,
              status: 'connected',
              phoneNumber: instanceInfo.phoneNumber || null,
              profileName: instanceInfo.profileName || null,
              connectedAt: new Date(),
              lastActivity: new Date()
            });
            
            console.log(`[Evolution Webhook] ✅ Sesión guardada en BD para ${businessId}`);
          }
        } catch (err) {
          console.error('[Evolution Webhook] ❌ Error obteniendo info de instancia:', err.message);
        }
      } else if (connectionState === 'close' || connectionState === 'disconnected') {
        console.log(`[Evolution Webhook] ⚠️ Instancia ${businessId} desconectada`);
        
        // Actualizar memoria también
        const { setInstance } = require('../services/evolution/state');
        setInstance(businessId, {
          instanceName: businessId,
          status: 'disconnected',
          createdAt: new Date()
        });
        
        await models.WhatsAppSession.update(
          { status: 'disconnected', lastActivity: new Date() },
          { where: { businessId } }
        );
      }
    }
    
    // Manejar evento de QR actualizado
    if (event === 'qrcode.update' || event === 'qrcode_updated') {
      console.log(`[Evolution Webhook] 📲 QR actualizado para ${businessId}`);
      
      if (data?.base64) {
        whatsappService.currentQRs.set(businessId, data.base64);
        console.log(`[Evolution Webhook] ✅ QR guardado en memoria para ${businessId}`);
      }
    }
    
    // Manejar evento de mensaje entrante
    if (event === 'MESSAGES_UPSERT' || event === 'messages.upsert' || event === 'message_create') {
      console.log(`[Evolution Webhook] 📥 Mensaje entrante para ${businessId}, evento: ${event}`);
      console.log(`[Evolution Webhook] 📦 Payload completo:`, JSON.stringify(req.body).substring(0, 1000));
      
      try {
        // Evolution API v2.1.2 envía el mensaje en data.key y data.message
        const message = data?.key || data;
        const msgBody = data?.message?.conversation || 
                       data?.message?.extendedTextMessage?.text || 
                       data?.text || 
                       data?.body || '';
        
        const from = message?.remoteJid || 
                    message?.from || 
                    data?.key?.remoteJid || 
                    data?.remoteJid || '';
        
        const participant = data?.participant || 
                          data?.key?.participant || 
                          message?.participant ||
                          data?.sender ||
                          req.body?.sender ||
                          '';
        
        const pushName = data?.pushName || 
                        message?.pushName || '';
        
        const messageId = message?.id || 
                         message?._serialized || 
                         data?.key?.id || 
                         data?.id;
        
        console.log(`[Evolution Webhook] 🔍 Extraído - from: ${from}, participant: ${participant}, pushName: ${pushName}, body: "${msgBody}", id: ${messageId}`);
        
        if (from && msgBody) {
          const mockMsg = {
            body: msgBody,
            from: from,
            participant: participant,
            pushName: pushName,
            id: { _serialized: messageId }
          };
          
          console.log(`[Evolution Webhook] 📨 Procesando mensaje: "${msgBody}" de ${from}`);
          
          // Procesar respuesta del cliente
          await whatsappService.handleClientResponse(businessId, null, mockMsg);
          
          console.log(`[Evolution Webhook] ✅ Mensaje procesado para ${businessId}`);
        } else {
          console.log(`[Evolution Webhook] ⚠️ Mensaje incompleto - from: ${from}, body: "${msgBody}"`);
        }
      } catch (msgErr) {
        console.error('[Evolution Webhook] ❌ Error procesando mensaje:', msgErr.message);
        console.error('[Evolution Webhook] ❌ Stack:', msgErr.stack);
      }
    }
    
    res.status(200).json({ message: 'OK' });
  } catch (e) {
    console.error('[Evolution Webhook] ❌ Error procesando webhook:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
