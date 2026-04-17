/**
 * Utilidad para generar códigos de referencia únicos para citas
 */

const { Appointment } = require('../models');

// Caracteres para el código (excluimos caracteres confusos: 0, O, 1, I, L)
const CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

/**
 * Genera un código aleatorio de 6 caracteres
 */
function generateRandomCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CHARS.charAt(Math.floor(Math.random() * CHARS.length));
  }
  return code;
}

/**
 * Genera un código único que no existe en la base de datos
 * Reintenta hasta 10 veces si hay colisiones
 */
async function generateUniqueReferenceCode(maxRetries = 10) {
  for (let i = 0; i < maxRetries; i++) {
    const code = generateRandomCode();

    // Verificar si ya existe
    const existing = await Appointment.findOne({
      where: { referenceCode: code }
    });

    if (!existing) {
      return code; // Código único encontrado
    }

    console.log(`[ReferenceCode] ⚠️ Colisión detectada con ${code}, reintentando...`);
  }

  throw new Error('No se pudo generar un código único después de 10 intentos');
}

/**
 * Extrae un código de referencia de un texto
 * Busca patrones como "ABC123", "Ref: ABC123", "Cita #ABC123", etc.
 */
function extractReferenceCode(text) {
  // Patrón: código de 6 caracteres alfanuméricos (excluyendo confusos)
  // Puede estar precedido por "#", "Ref:", "Referencia:", "Cita", etc.
  const patterns = [
    /#([A-HJ-KM-NP-Z2-9]{6})/i,           // #ABC123
    /Ref(?:erencia)?[:\s]*([A-HJ-KM-NP-Z2-9]{6})/i,  // Ref: ABC123, Referencia: ABC123
    /Cita[:\s#]*([A-HJ-KM-NP-Z2-9]{6})/i, // Cita ABC123, Cita #ABC123
    /Código[:\s]*([A-HJ-KM-NP-Z2-9]{6})/i, // Código: ABC123
    /\b([A-HJ-KM-NP-Z2-9]{6})\b/i        // ABC123 suelto (último recurso)
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1].toUpperCase();
    }
  }

  return null;
}

module.exports = {
  generateRandomCode,
  generateUniqueReferenceCode,
  extractReferenceCode
};
