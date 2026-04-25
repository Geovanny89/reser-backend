const {
  getAllUsers,
  getUserById,
  createUser,
  updateUser,
  toggleUserStatus,
  resetPassword,
  deleteUser,
} = require('./users.controller');

const { impersonateUser } = require('./impersonation.controller');

const {
  getActivityLogs,
  getActivityStats,
} = require('./activity.service');

const {
  getGlobalFinancialReport,
  getGlobalStats,
} = require('./reports.controller');

module.exports = {
  // Usuarios
  getAllUsers,
  getUserById,
  createUser,
  updateUser,
  toggleUserStatus,
  resetPassword,
  deleteUser,

  // Impersonación
  impersonateUser,

  // Activity Logs
  getActivityLogs,
  getActivityStats,

  // Reportes
  getGlobalFinancialReport,
  getGlobalStats,
};
