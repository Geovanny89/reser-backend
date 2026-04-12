const router = require('express').Router();
const auth = require('../middleware/auth');
const whatsappService = require('../services/whatsappService');
const models = require('../models');

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
        
        // Verificar si por casualidad ya se conectó
        const client = whatsappService.instances.get(businessId);
        if (client) {
           client.getState().then(state => {
              if (state === 'CONNECTED') return res.json({ status: 'connected' });
              return res.status(408).json({ error: 'El servidor de WhatsApp está tardando en responder. Por favor, dale un momento y vuelve a intentar.' });
           }).catch(() => {
              return res.status(408).json({ error: 'Error al verificar estado. Intenta de nuevo.' });
           });
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
        actualStatus = 'disconnected';
        // Auto-corregir DB si la instancia no existe
        await models.WhatsAppSession.update({ status: 'disconnected' }, { where: { businessId } });
      }
    }

    res.json({ status: actualStatus });
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

module.exports = router;
