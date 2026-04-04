const router  = require('express').Router();
const multer  = require('multer');
const auth    = require('../middleware/auth');
const role    = require('../middleware/role');
const { Business } = require('../models');
const { storage, deleteFromCloudinary } = require('../config/cloudinary');

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // Bajamos a 5MB (Cloudinary optimiza el peso)
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Solo se permiten imágenes'));
  }
});

// Subir imagen genérica (logo, banner, etc.)
router.post('/', auth, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió ninguna imagen' });
  // Multer Cloudinary nos da la URL final directamente
  const url = req.file.path;
  res.json({ url, public_id: req.file.filename });
});

// Subir múltiples imágenes para la galería
router.post('/gallery', auth, role('admin'), upload.array('images', 20), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No se recibieron imágenes' });
    }
    const urls = req.files.map(f => f.path);
    const biz = await Business.findOne({ where: { ownerId: req.user.id } });
    if (biz) {
      let gallery = [];
      try { gallery = JSON.parse(biz.gallery || '[]'); } catch { gallery = []; }
      gallery = [...gallery, ...urls];
      // Limitar a un máximo de 20 imágenes por galería
      if (gallery.length > 20) gallery = gallery.slice(-20);
      await biz.update({ gallery: JSON.stringify(gallery) });
    }
    res.json({ urls, message: `${urls.length} imagen(es) subida(s) correctamente` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Eliminar imagen de la galería
router.delete('/gallery/remove', auth, role('admin'), async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL requerida' });
    const biz = await Business.findOne({ where: { ownerId: req.user.id } });
    if (!biz) return res.status(404).json({ error: 'Negocio no encontrado' });
    
    let gallery = [];
    try { gallery = JSON.parse(biz.gallery || '[]'); } catch { gallery = []; }
    
    // Si la URL estaba en la galería, la eliminamos de Cloudinary y de la DB
    if (gallery.includes(url)) {
      gallery = gallery.filter(u => u !== url);
      await biz.update({ gallery: JSON.stringify(gallery) });
      await deleteFromCloudinary(url);
    }
    
    res.json({ message: 'Imagen eliminada', gallery });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
