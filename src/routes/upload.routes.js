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
router.post('/gallery', auth, role('admin', 'admin_suc'), upload.array('images', 20), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No se recibieron imágenes' });
    }
    const urls = req.files.map(f => f.path);
    
    // Buscar negocio (dueño o admin sucursal)
    let biz = await Business.findOne({ where: { ownerId: req.user.id } });
    if (!biz && req.user.role === 'admin_suc') {
      const { Employee } = require('../models');
      const emp = await Employee.findOne({ where: { userId: req.user.id, isManager: true } });
      if (emp) biz = await Business.findByPk(emp.businessId);
    }

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
router.delete('/gallery/remove', auth, role('admin', 'admin_suc'), async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL requerida' });
    
    // Buscar negocio (dueño o admin sucursal)
    let biz = await Business.findOne({ where: { ownerId: req.user.id } });
    if (!biz && req.user.role === 'admin_suc') {
      const { Employee } = require('../models');
      const emp = await Employee.findOne({ where: { userId: req.user.id, isManager: true } });
      if (emp) biz = await Business.findByPk(emp.businessId);
    }

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

// Eliminar imagen individual de Cloudinary (para cualquier URL)
router.delete('/image', auth, async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL de imagen requerida' });
    
    // Verificar que es una URL de Cloudinary válida
    if (!url.includes('cloudinary.com')) {
      return res.status(400).json({ error: 'Solo se pueden eliminar imágenes de Cloudinary' });
    }
    
    await deleteFromCloudinary(url);
    res.json({ message: 'Imagen eliminada correctamente' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
