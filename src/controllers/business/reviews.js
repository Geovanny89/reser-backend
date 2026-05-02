/**
 * Controladores para gestión de reseñas
 */
const { Business } = require('../../models');
const cacheService = require('../../services/cacheService');

// POST /businesses/:slug/reviews
exports.createReview = async (req, res) => {
  try {
    const { BusinessReview } = require('../../models');
    const { slug } = req.params;
    const { clientName, rating, comment } = req.body;
    
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'La calificación debe estar entre 1 y 5 estrellas' });
    }
    
    const business = await Business.findOne({ where: { slug } });
    if (!business) return res.status(404).json({ error: 'Negocio no encontrado' });
    
    const review = await BusinessReview.create({
      businessId: business.id,
      clientName: clientName || 'Cliente Anónimo',
      rating,
      comment: comment || null,
      isApproved: true
    });
    
    // Invalida caché de la página pública del negocio
    cacheService.invalidateBusinessPublic(slug);
    
    res.status(201).json({
      message: 'Reseña creada exitosamente',
      review
    });
  } catch (e) {
    console.error('[createReview] Error:', e);
    res.status(500).json({ error: e.message });
  }
};

// GET /businesses/my/reviews
exports.getReviews = async (req, res) => {
  try {
    const { BusinessReview } = require('../../models');
    const { businessId } = req.query;
    
    if (!businessId) return res.status(400).json({ error: 'businessId es requerido' });
    
    const reviews = await BusinessReview.findAll({
      where: { businessId },
      order: [['createdAt', 'DESC']]
    });
    
    res.json(reviews);
  } catch (e) {
    console.error('[getReviews] Error:', e);
    res.status(500).json({ error: e.message });
  }
};

// PATCH /businesses/reviews/:reviewId/approve
exports.toggleReviewApproval = async (req, res) => {
  try {
    const { BusinessReview } = require('../../models');
    const { reviewId } = req.params;
    
    const review = await BusinessReview.findByPk(reviewId);
    if (!review) return res.status(404).json({ error: 'Reseña no encontrada' });
    
    const business = await Business.findByPk(review.businessId);
    const isOwner = business.ownerId === req.user.id;
    const isAdmin = req.user.role === 'admin' || req.user.role === 'admin_suc' || req.user.role === 'superadmin';
    
    if (!isOwner && !isAdmin) return res.status(403).json({ error: 'No autorizado' });
    
    review.isApproved = !review.isApproved;
    await review.save();
    
    // Invalida caché de la página pública del negocio
    cacheService.invalidateBusinessPublic(business.slug);
    
    res.json({
      message: `Reseña ${review.isApproved ? 'aprobada' : 'desaprobada'}`,
      review
    });
  } catch (e) {
    console.error('[toggleReviewApproval] Error:', e);
    res.status(500).json({ error: e.message });
  }
};

// DELETE /businesses/reviews/:reviewId
exports.deleteReview = async (req, res) => {
  try {
    const { BusinessReview } = require('../../models');
    const { reviewId } = req.params;
    
    const review = await BusinessReview.findByPk(reviewId);
    if (!review) return res.status(404).json({ error: 'Reseña no encontrada' });
    
    const business = await Business.findByPk(review.businessId);
    const isOwner = business.ownerId === req.user.id;
    const isAdmin = req.user.role === 'admin' || req.user.role === 'admin_suc' || req.user.role === 'superadmin';
    
    if (!isOwner && !isAdmin) return res.status(403).json({ error: 'No autorizado' });
    
    await review.destroy();
    
    // Invalida caché de la página pública del negocio
    cacheService.invalidateBusinessPublic(business.slug);
    
    res.json({ message: 'Reseña eliminada' });
  } catch (e) {
    console.error('[deleteReview] Error:', e);
    res.status(500).json({ error: e.message });
  }
};
