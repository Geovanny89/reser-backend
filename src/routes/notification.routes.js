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
    
    // Si ya está conectado (verificación real), no crear otra
    if (await whatsappService.hasValidSession(businessId)) {
      return res.json({ status: 'connected' });
    }

    // Forzamos forceFresh=true para asegurar que se aplique el nuevo nombre y nos dé un QR fresco
    await whatsappService.createInstance(businessId, true);

    // Esperar un poco a que se genere el QR (el evento 'qr' en whatsappService lo guardará en currentQRs)
    let attempts = 0;
    const maxAttempts = 120; // Aumentar a 120 segundos para dar tiempo suficiente a Evolution API v2.3.7
    
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

// Ruta para ver estado REAL de la conexión (consulta Evolution API, no solo BD)
router.get('/whatsapp/status', auth, async (req, res) => {
  try {
    const { businessId } = req.query;
    if (!businessId) {
      return res.status(400).json({ error: 'businessId es requerido' });
    }
    
    const session = await models.WhatsAppSession.findOne({ where: { businessId } });
    let dbStatus = session?.status || 'disconnected';
    
    // VERIFICAR ESTADO REAL EN EVOLUTION API (fuente de verdad)
    let realState = 'disconnected';
    try {
      if (whatsappService.hasValidSession) {
        const isValid = await whatsappService.hasValidSession(businessId);
        if (isValid) {
          realState = 'connected';
        } else {
          // La instancia existe pero no está conectada, obtener estado exacto
          const { getConnectionState } = require('../services/evolution/instanceManager');
          const rawState = await getConnectionState(businessId);
          if (rawState === 'connecting') {
            realState = 'connecting';
          } else if (rawState === 'open' || rawState === 'connected') {
            realState = 'connected';
          } else {
            realState = 'disconnected';
          }
        }
      }
    } catch (e) {
      console.warn(`[WhatsApp Status] ⚠️ No se pudo consultar Evolution API:`, e.message);
    }
    
    // Si hay discrepancia entre BD y realidad, actualizar BD
    if (dbStatus === 'connected' && realState !== 'connected') {
      console.log(`[WhatsApp Status] ⚠️ Discrepancia detectada: BD dice '${dbStatus}' pero Evolution API reporta '${realState}'. Sincronizando BD...`);
      await models.WhatsAppSession.update(
        { status: realState, lastActivity: new Date() },
        { where: { businessId } }
      );
      dbStatus = realState;
    }
    
    // Si BD dice disconnected pero Evolution dice connected, actualizar BD
    if ((dbStatus === 'disconnected' || !session) && realState === 'connected') {
      const businessExists = await models.Business.findByPk(businessId);
      if (businessExists) {
        await models.WhatsAppSession.upsert({
          businessId,
          status: 'connected',
          lastActivity: new Date()
        });
        dbStatus = 'connected';
      }
    }
    
    // Si está en connecting, asegurar que el estado reportado sea connecting
    if (realState === 'connecting') {
      dbStatus = 'connecting';
    }

    res.json({
      status: dbStatus,
      realState: realState,
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
    
    // PASO 1: Desconectar primero si hay instancia activa
    try {
      await whatsappService.stopInstance(businessId);
      console.log(`[WhatsApp Route] ✅ Instancia detenida, esperando...`);
      await new Promise(resolve => setTimeout(resolve, 3000));
    } catch (stopErr) {
      console.log(`[WhatsApp Route] ℹ️ No se pudo detener instancia (puede que no exista):`, stopErr.message);
    }
    
    // PASO 2: Limpiar estado en base de datos
    await models.WhatsAppSession.update({ status: 'disconnected' }, { where: { businessId } });
    
    // PASO 3: Crear nueva instancia
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
    const rawBody = JSON.stringify(req.body);
    console.log('[Evolution Webhook] 📨 Webhook recibido:', rawBody.substring(0, 1000));
    console.log('[Evolution Webhook] 🔍 Headers:', JSON.stringify(req.headers));
    
    let businessId = req.body.instance || req.body.instanceName;
    
    // Normalizar ID si tiene sufijo dinámico (ej: uuid_1234 -> uuid)
    if (businessId && businessId.includes('_')) {
      const parts = businessId.split('_');
      // Si la última parte son solo números, es nuestro sufijo dinámico
      if (/^\d+$/.test(parts[parts.length - 1])) {
        businessId = parts.slice(0, -1).join('_');
      }
    }

    const actualEvent = req.body.event || req.body.type;
    const data = req.body.data;

    console.log(`[Evolution Webhook] 📨 Webhook recibido: ${actualEvent} para ID: '${businessId}' (Original: ${req.body.instance || req.body.instanceName})`);
    
    const actualInstance = businessId;
    
    if (!actualInstance) {
      console.log('[Evolution Webhook] ⚠️ Webhook sin instancia identificable, ignorando');
      return res.status(200).json({ message: 'OK' });
    }

    // Validar si el businessId es un UUID válido antes de proceder con DB
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const isUUID = uuidRegex.test(actualInstance);

    if (!isUUID) {
      console.log(`[Evolution Webhook] ℹ️ Instancia '${actualInstance}' no es un UUID válido. Procesando solo en memoria.`);
      
      // Si es qrcode.update, guardar en memoria de todos modos
      if (actualEvent === 'qrcode.update' || actualEvent === 'qrcode_updated' || actualEvent === 'QRCODE_UPDATED' || actualEvent === 'qrcode.updated') {
        const qrBase64 = data?.base64 || data?.qrcode?.base64 || data?.code;
        if (qrBase64) {
          whatsappService.currentQRs.set(actualInstance, qrBase64);
          console.log(`[Evolution Webhook] 📲 QR capturado en memoria para instancia de prueba: ${actualInstance}`);
        }
      }
      return res.status(200).json({ message: 'OK (Non-UUID instance processed in memory)' });
    }
    
    // Manejar evento de conexión
    if (actualEvent === 'connection.update' || actualEvent === 'connection_update' || actualEvent === 'CONNECTION_UPDATE') {
      const connectionState = data?.state || data?.connectionState;
      console.log(`[Evolution Webhook] 🔌 Estado de conexión para ${businessId}: ${connectionState}`);
      
      if (connectionState === 'open' || connectionState === 'connected') {
        console.log(`[Evolution Webhook] ✅ Instancia ${businessId} conectada, guardando sesión...`);
        
        // IMPORTANTE: Actualizar estado en memoria con el nombre REAL (con sufijo) para que las consultas funcionen
        const { setInstance } = require('../services/evolution/state');
        setInstance(businessId, {
          instanceName: req.body.instance || req.body.instanceName || businessId,
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
        const statusReason = data?.statusReason || data?.reason;
        console.log(`[Evolution Webhook] ⚠️ Instancia ${businessId} desconectada. Razón: ${statusReason}`);
        
        // Determinar estado final
        let finalStatus = 'disconnected';
        if (statusReason === 401) {
          console.log(`[Evolution Webhook] 🔴 ERROR DE AUTENTICACIÓN (401) para ${businessId}. Sesión invalidada.`);
          finalStatus = 'disconnected';
        }
        
        // Actualizar memoria
        const { setInstance } = require('../services/evolution/state');
        setInstance(businessId, {
          instanceName: businessId,
          status: finalStatus,
          statusReason: statusReason,
          updatedAt: new Date()
        });
        
        await models.WhatsAppSession.update(
          { 
            status: finalStatus, 
            lastActivity: new Date(),
            // Guardar razón en un campo de log si existiera, por ahora en status
          },
          { where: { businessId } }
        );

        // Si es 401, podríamos emitir un socket para avisar al frontend
        if (global.io) {
          global.io.to(`business:${businessId}`).emit('whatsapp_status', { 
            status: finalStatus,
            reason: 'auth_failure'
          });
        }
      }
    }
    
    // Manejar evento de QR actualizado
    if (actualEvent === 'qrcode.update' || actualEvent === 'qrcode_updated' || actualEvent === 'QRCODE_UPDATED' || actualEvent === 'qrcode.updated') {
      const qrBase64 = data?.base64 || data?.qrcode?.base64 || data?.code;
      if (qrBase64) {
        console.log(`[Evolution Webhook] 📲 QR capturado para ${businessId}`);
        whatsappService.currentQRs.set(businessId, qrBase64);
      }
    }
    
    // Manejar evento de mensaje entrante
    if (actualEvent === 'MESSAGES_UPSERT' || actualEvent === 'messages.upsert' || actualEvent === 'message_create' || actualEvent === 'messages_update') {
      console.log(`[Evolution Webhook] 📥 MENSAJE COMPLETO RECIBIDO:`, JSON.stringify(req.body, null, 2));
      console.log(`[Evolution Webhook] 📥 Mensaje entrante para ${businessId}, evento: ${actualEvent}`);
      console.log(`[Evolution Webhook] 📦 Payload corto:`, JSON.stringify(req.body).substring(0, 500));
      
      try {
        // Evolution API v2.1.2 envía el mensaje en data.key y data.message
        const message = data?.key || data;
        
        // Buscar texto en mensaje normal
        const messageText = data?.message?.conversation || 
                           data?.message?.extendedTextMessage?.text || 
                           data?.text || 
                           data?.body || '';
                           
        // Buscar en respuestas interactivas (botones, listas, templates)
        let interactiveResponse = '';
        
        try {
          if (data?.message?.buttonsResponseMessage) {
            interactiveResponse = data.message.buttonsResponseMessage.selectedDisplayText || 
                                 data.message.buttonsResponseMessage.selectedButtonId || '';
          } else if (data?.message?.templateButtonReplyMessage) {
            interactiveResponse = data.message.templateButtonReplyMessage.selectedDisplayText || 
                                 data.message.templateButtonReplyMessage.selectedId || '';
          } else if (data?.message?.listResponseMessage) {
            interactiveResponse = data.message.listResponseMessage.title || 
                                 data.message.listResponseMessage.singleSelectReply?.selectedRowId || '';
          } else if (data?.message?.interactiveResponseMessage) {
             const nativeFlow = data.message.interactiveResponseMessage.nativeFlowResponseMessage;
             if (nativeFlow) {
               try {
                 const params = JSON.parse(nativeFlow.paramsJson || '{}');
                 // Priorizar id (puede ser "confirm", "cancel", etc.) o el nombre
                 interactiveResponse = params.id || nativeFlow.name || '';
               } catch (e) {
                 interactiveResponse = nativeFlow.name || '';
               }
             } else {
               interactiveResponse = data.message.interactiveResponseMessage.body?.text || '';
             }
          }
        } catch (e) {
          console.error('[Evolution Webhook] Error extrayendo respuesta interactiva:', e.message);
        }
        
        const msgBody = interactiveResponse || messageText;
        
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
