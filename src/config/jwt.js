require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret';
const JWT_EXPIRES = '7d';

module.exports = { JWT_SECRET, JWT_EXPIRES };
