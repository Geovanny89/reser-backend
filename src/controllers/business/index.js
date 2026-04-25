/**
 * Controlador de negocios - Módulo principal
 * Re-exporta todos los controladores desde submódulos organizados
 */

// Consultas
const {
  getAll,
  getMyBusiness,
  getBySlug,
  getByIdPublic,
  getAvailability,
  getMyBranches,
  getAvailablePlans
} = require('./queries');

// CRUD
const {
  create,
  update,
  updateMyBusiness,
  remove,
  toggleStatus,
  updateMissionVision
} = require('./crud');

// Sucursales
const {
  requestBranch,
  approveBranch
} = require('./branch');

// Pagos y suscripciones
const {
  updateSubscription,
  uploadPaymentScreenshot,
  markScreenshotViewed,
  approvePayment,
  submitPayment,
  getSubscriptionInfo,
  updateSubscriptionPlan,
  addAdditionalUsers
} = require('./payment');

// Reseñas
const {
  createReview,
  getReviews,
  toggleReviewApproval,
  deleteReview
} = require('./reviews');

module.exports = {
  // Queries
  getAll,
  getMyBusiness,
  getBySlug,
  getByIdPublic,
  getAvailability,
  getMyBranches,
  getAvailablePlans,
  
  // CRUD
  create,
  update,
  updateMyBusiness,
  remove,
  toggleStatus,
  updateMissionVision,
  
  // Sucursales
  requestBranch,
  approveBranch,
  
  // Pagos
  updateSubscription,
  uploadPaymentScreenshot,
  markScreenshotViewed,
  approvePayment,
  submitPayment,
  getSubscriptionInfo,
  updateSubscriptionPlan,
  addAdditionalUsers,
  
  // Reseñas
  createReview,
  getReviews,
  toggleReviewApproval,
  deleteReview
};
