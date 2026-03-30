const router  = require('express').Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const auth    = require('../middleware/auth');
const role    = require('../middleware/role');
const { Business } = require('../models');

const UPLOADS_DIR = path.join(__dirname, '../../uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const name = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    cb(null, name);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Solo se permiten imágenes'));
  }
});

// Subir imagen genérica (logo, banner, etc.)
router.post('/', auth, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió ninguna imagen' });
  const url = `/uploads/${req.file.filename}`;
  res.json({ url, filename: req.file.filename });
});

// Subir múltiples imágenes para la galería
router.post('/gallery', auth, role('admin'), upload.array('images', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No se recibieron imágenes' });
    }
    const urls = req.files.map(f => `/uploads/${f.filename}`);
    const biz = await Business.findOne({ where: { ownerId: req.user.id } });
    if (biz) {
      let gallery = [];
      try { gallery = JSON.parse(biz.gallery || '[]'); } catch { gallery = []; }
      gallery = [...gallery, ...urls];
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
    gallery = gallery.filter(u => u !== url);
    await biz.update({ gallery: JSON.stringify(gallery) });
    const filename = path.basename(url);
    const filepath = path.join(UPLOADS_DIR, filename);
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
    res.json({ message: 'Imagen eliminada', gallery });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
