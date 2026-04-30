const { PlatformReview, Business } = require('../models');

/**
 * Enviar una reseña de la plataforma (desde el panel del negocio)
 */
exports.submitReview = async (req, res) => {
  try {
    const { businessId, rating, comment, reviewerName } = req.body;

    if (!businessId || !rating || !comment) {
      return res.status(400).json({ error: 'Faltan campos obligatorios' });
    }

    const business = await Business.findByPk(businessId);
    if (!business) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }

    // Buscar si ya existe una reseña de este negocio para actualizarla o crear una nueva
    let review = await PlatformReview.findOne({ where: { businessId } });

    if (review) {
      await review.update({
        rating,
        comment,
        reviewerName: reviewerName || review.reviewerName,
        isApproved: false // Al editar, se vuelve a poner en pendiente de aprobación
      });
    } else {
      review = await PlatformReview.create({
        businessId,
        businessName: business.name,
        reviewerName: reviewerName || 'Dueño de Negocio',
        rating,
        comment,
        isApproved: false
      });
    }

    res.status(201).json({ message: 'Reseña enviada correctamente. Pendiente de moderación.', review });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

/**
 * Obtener todas las reseñas (Solo SuperAdmin)
 */
exports.getAll = async (req, res) => {
  try {
    const reviews = await PlatformReview.findAll({
      order: [['createdAt', 'DESC']],
      include: [{ model: Business, as: 'Business', attributes: ['name', 'logoUrl'] }]
    });
    res.json(reviews);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

/**
 * Obtener reseñas aprobadas (Público - Landing Page)
 */
exports.getPublic = async (req, res) => {
  try {
    const reviews = await PlatformReview.findAll({
      where: { isApproved: true },
      order: [['rating', 'DESC'], ['createdAt', 'DESC']],
      attributes: ['reviewerName', 'businessName', 'rating', 'comment']
    });
    res.json(reviews);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

/**
 * Aprobar/Rechazar reseña (Solo SuperAdmin)
 */
exports.moderate = async (req, res) => {
  try {
    const { id } = req.params;
    const { isApproved } = req.body;

    const review = await PlatformReview.findByPk(id);
    if (!review) {
      return res.status(404).json({ error: 'Reseña no encontrada' });
    }

    await review.update({ isApproved });
    res.json({ message: `Reseña ${isApproved ? 'aprobada' : 'rechazada'} correctamente`, review });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

/**
 * Eliminar reseña
 */
exports.remove = async (req, res) => {
  try {
    const review = await PlatformReview.findByPk(req.params.id);
    if (!review) return res.status(404).json({ error: 'Reseña no encontrada' });
    await review.destroy();
    res.json({ message: 'Reseña eliminada' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

/**
 * Verificar si un negocio ya tiene una reseña (para ocultar el banner)
 */
exports.checkStatus = async (req, res) => {
  try {
    const { businessId } = req.params;
    const review = await PlatformReview.findOne({ where: { businessId } });
    res.json({ hasReviewed: !!review });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
