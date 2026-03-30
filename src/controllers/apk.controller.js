const { Business } = require('../models');
const fs = require('fs');
const path = require('path');

// Ruta de la APK universal (misma para todos los negocios)
const UNIVERSAL_APK_PATH = path.join(__dirname, '../../uploads/kdice-app.apk');

// Función para obtener ruta de APK personalizada por negocio
const getBusinessApkPath = (businessSlug) => path.join(__dirname, `../../uploads/kdice-${businessSlug}.apk`);

/**
 * Generar/preparar APK universal KDice
 */
exports.generateAPK = async (req, res) => {
  try {
    const { businessId, businessSlug, businessName } = req.body;

    const business = await Business.findByPk(businessId);
    if (!business) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }

    if (business.ownerId !== req.user.id) {
      return res.status(403).json({ error: 'No tienes permiso para descargar esta APK' });
    }

    const apkExists = fs.existsSync(UNIVERSAL_APK_PATH);
    const downloadUrl = `/api/apk/download/${businessSlug}/android`;

    console.log(`[APK] Solicitud de APK universal KDice para negocio: ${businessName} (${businessSlug})`);
    console.log(`[APK] APK universal existe: ${apkExists}`);

    res.json({
      success: true,
      message: apkExists ? 'APK KDice lista para descargar' : 'APK en preparación',
      downloadUrl,
      businessSlug,
      businessName,
      apkReady: apkExists,
      universal: true,
      instructions: {
        android: 'Descarga la APK KDice universal e instálala. Al iniciar sesión, ingresa tus credenciales de negocio.',
        ios: 'Para iOS, contacta a soporte para distribución en App Store o TestFlight.'
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.generateIPA = async (req, res) => {
  try {
    const { businessId } = req.body;
    const business = await Business.findByPk(businessId);
    if (!business) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }
    if (business.ownerId !== req.user.id) {
      return res.status(403).json({ error: 'No tienes permiso' });
    }
    res.json({
      success: true,
      message: 'Para iOS, contacta a soporte para distribución en App Store o TestFlight.',
      businessSlug: business.slug,
      businessName: business.name,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

/**
 * Verificar si hay una versión más reciente de la APK universal
 */
exports.checkForUpdate = async (req, res) => {
  try {
    const { slug } = req.params;

    const business = await Business.findOne({ where: { slug } });
    if (!business) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }

    const apkExists = fs.existsSync(UNIVERSAL_APK_PATH);
    
    if (!apkExists) {
      return res.json({
        hasUpdate: false,
        message: 'No hay APK universal disponible',
        currentVersion: null,
        latestVersion: null,
        universal: true
      });
    }

    // Obtener información del archivo universal
    const apkStats = fs.statSync(UNIVERSAL_APK_PATH);
    const currentVersion = {
      hash: require('crypto').createHash('md5').update(fs.readFileSync(UNIVERSAL_APK_PATH)).digest('hex'),
      size: apkStats.size,
      lastModified: apkStats.mtime.toISOString(),
      fileName: `kdice-app.apk`
    };

    // Simular versión del servidor (en una app real vendría de una BD)
    const latestVersion = {
      version: '1.0.1',
      releaseDate: new Date().toISOString(),
      changes: [
        'Mejoras en el sistema de notificaciones',
        'Optimización del rendimiento',
        'Corrección de bugs menores'
      ]
    };

    // Comparar versiones (simulado - en producción sería con BD)
    const hasUpdate = false; // Siempre false por ahora, o podrías comparar hashes

    res.json({
      hasUpdate,
      currentVersion,
      latestVersion,
      apkExists: true,
      downloadUrl: `/api/apk/download/${slug}/android`,
      universal: true,
      message: hasUpdate 
        ? 'Hay una nueva versión disponible' 
        : 'Tienes la versión más reciente'
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

/**
 * Descargar la APK universal KDice
 */
exports.downloadAPK = async (req, res) => {
  try {
    const { slug } = req.params;

    // Verificar que el negocio existe
    const business = await Business.findOne({ where: { slug } });
    if (!business) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }

    // Verificar que la APK universal existe
    if (!fs.existsSync(UNIVERSAL_APK_PATH)) {
      return res.status(404).json({ 
        error: 'APK KDice no disponible',
        message: 'La APK KDice universal no está disponible. Contacta a soporte.'
      });
    }

    // Obtener información del archivo universal
    const apkStats = fs.statSync(UNIVERSAL_APK_PATH);
    const fileName = `kdice-app.apk`;
    const fileHash = require('crypto').createHash('md5').update(fs.readFileSync(UNIVERSAL_APK_PATH)).digest('hex');
    const lastModified = apkStats.mtime.toISOString();
    
    console.log(`[APK] Descarga de APK universal KDice para negocio: ${business.name} (${slug})`);
    console.log(`[APK] Archivo: ${fileName}`);
    console.log(`[APK] Tamaño: ${(apkStats.size / 1024 / 1024).toFixed(1)} MB`);
    
    // Configurar headers para descarga con control de caché
    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', apkStats.size);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('ETag', `"${fileHash}"`);
    res.setHeader('Last-Modified', lastModified);
    
    // Stream del archivo universal
    const fileStream = fs.createReadStream(UNIVERSAL_APK_PATH);
    fileStream.pipe(res);
    
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

/**
 * Descargar IPA (iOS) - no disponible en esta versión
 */
exports.downloadIPA = async (req, res) => {
  res.status(503).json({ 
    error: 'La versión iOS no está disponible actualmente.',
    message: 'Contacta a soporte para distribución en App Store o TestFlight.'
  });
};

/**
 * Obtener estado de la APK universal
 */
exports.getAPKStatus = async (req, res) => {
  try {
    const { businessId } = req.params;

    const business = await Business.findByPk(businessId);
    if (!business) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }

    if (business.ownerId !== req.user.id) {
      return res.status(403).json({ error: 'No tienes permiso' });
    }

    const apkExists = fs.existsSync(UNIVERSAL_APK_PATH);
    const apkStats = apkExists ? fs.statSync(UNIVERSAL_APK_PATH) : null;

    res.json({
      businessId,
      businessSlug: business.slug,
      businessName: business.name,
      status: apkExists ? 'ready' : 'unavailable',
      apkReady: apkExists,
      apkSize: apkStats ? `${(apkStats.size / 1024 / 1024).toFixed(1)} MB` : null,
      lastGenerated: apkStats ? apkStats.mtime : null,
      apkUrl: `/api/apk/download/${business.slug}/android`,
      universal: true,
      instructions: {
        android: [
          '1. Descarga el archivo APK universal',
          '2. En tu Android, ve a Ajustes > Seguridad',
          '3. Habilita "Fuentes desconocidas" o "Instalar apps desconocidas"',
          '4. Abre el archivo APK descargado',
          '5. Toca "Instalar" y espera',
          '6. Abre KDice e ingresa el slug de tu negocio'
        ]
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
