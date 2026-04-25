const { Op } = require('../../models');

const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  SERVER_ERROR: 500,
};

function successResponse(res, data, status = HTTP_STATUS.OK) {
  return res.status(status).json(data);
}

function errorResponse(res, message, status = HTTP_STATUS.SERVER_ERROR) {
  return res.status(status).json({ error: message });
}

function buildPaginationMeta({ count, page, limit }) {
  return {
    total: count,
    page: parseInt(page),
    pages: Math.ceil(count / limit),
    limit: parseInt(limit),
  };
}

function getPaginationParams(query) {
  const page = Math.max(1, parseInt(query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit) || 50));
  return { page, limit, offset: (page - 1) * limit };
}

function buildSearchWhere(search, fields) {
  if (!search) return null;
  return {
    [Op.or]: fields.map((field) => ({ [field]: { [Op.iLike]: `%${search}%` } })),
  };
}

function buildDateRangeWhere(startDate, endDate) {
  if (!startDate && !endDate) return null;
  const where = {};
  if (startDate) where[Op.gte] = new Date(startDate);
  if (endDate) where[Op.lte] = new Date(endDate);
  return where;
}

function getRedirectUrlByRole(role) {
  const urls = {
    superadmin: '/superadmin',
    admin: '/admin',
    admin_suc: '/admin',
    employee: '/employee',
  };
  return urls[role] || '/my-appointments';
}

module.exports = {
  HTTP_STATUS,
  successResponse,
  errorResponse,
  buildPaginationMeta,
  getPaginationParams,
  buildSearchWhere,
  buildDateRangeWhere,
  getRedirectUrlByRole,
};
