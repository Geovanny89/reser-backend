/**
 * Configuración de cliente API para Evolution
 * Archivo: evolution/api.js
 */
const axios = require('axios');
const constants = require('./constants');

const api = axios.create({
  baseURL: constants.BASE_URL,
  headers: {
    'apikey': constants.API_KEY,
    'Content-Type': 'application/json'
  },
  timeout: 60000 // 60 segundos de timeout para operaciones pesadas
});

module.exports = api;
