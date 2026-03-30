const { BusinessType } = require('../models');

/**
 * @swagger
 * /api/business-types:
 *   get:
 *     summary: Obtener todos los tipos de negocio
 *     tags: [BusinessTypes]
 *     responses:
 *       200:
 *         description: Lista de tipos de negocio
 */
exports.getAll = async (req, res) => {
  try {
    const types = await BusinessType.findAll({
      where: { active: true },
      order: [['order', 'ASC'], ['label', 'ASC']],
    });
    res.json(types);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

/**
 * @swagger
 * /api/business-types/all:
 *   get:
 *     summary: Obtener todos los tipos (incluyendo inactivos) - Solo superadmin
 *     tags: [BusinessTypes]
 *     security:
 *       - bearerAuth: []
 */
exports.getAllAdmin = async (req, res) => {
  try {
    const types = await BusinessType.findAll({
      order: [['order', 'ASC'], ['label', 'ASC']],
    });
    res.json(types);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

/**
 * @swagger
 * /api/business-types:
 *   post:
 *     summary: Crear un nuevo tipo de negocio
 *     tags: [BusinessTypes]
 *     security:
 *       - bearerAuth: []
 */
exports.create = async (req, res) => {
  try {
    const { value, label, icon, order } = req.body;
    if (!value || !label) return res.status(400).json({ error: 'value y label son requeridos' });
    const existing = await BusinessType.findOne({ where: { value } });
    if (existing) return res.status(409).json({ error: 'Ya existe un tipo con ese valor' });
    const type = await BusinessType.create({ value, label, icon: icon || '🏪', order: order || 0 });
    res.status(201).json(type);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};

/**
 * @swagger
 * /api/business-types/{id}:
 *   put:
 *     summary: Actualizar un tipo de negocio
 *     tags: [BusinessTypes]
 *     security:
 *       - bearerAuth: []
 */
exports.update = async (req, res) => {
  try {
    const type = await BusinessType.findByPk(req.params.id);
    if (!type) return res.status(404).json({ error: 'Tipo no encontrado' });
    await type.update(req.body);
    res.json(type);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};

/**
 * @swagger
 * /api/business-types/{id}:
 *   delete:
 *     summary: Eliminar un tipo de negocio
 *     tags: [BusinessTypes]
 *     security:
 *       - bearerAuth: []
 */
exports.remove = async (req, res) => {
  try {
    const type = await BusinessType.findByPk(req.params.id);
    if (!type) return res.status(404).json({ error: 'Tipo no encontrado' });
    await type.destroy();
    res.json({ message: 'Tipo eliminado correctamente' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
