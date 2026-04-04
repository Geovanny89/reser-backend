const PDFDocument = require('pdfkit');
const axios = require('axios');

/**
 * Helper para descargar imagen desde URL (Cloudinary, etc)
 * @param {string} url - URL de la imagen
 * @returns {Buffer|null} - Buffer de la imagen o null si falla
 */
async function downloadImage(url) {
  if (!url) return null;
  try {
    let fullUrl = url;
    // Si es una URL relativa, completarla con localhost
    if (url.startsWith('/')) {
      const port = process.env.PORT || 4000;
      fullUrl = `http://localhost:${port}${url}`;
    } else if (!url.startsWith('http')) {
      const port = process.env.PORT || 4000;
      fullUrl = `http://localhost:${port}/${url}`;
    }
    
    console.log('[PDFGenerator] Downloading image from:', fullUrl); // Debug
    
    const response = await axios.get(fullUrl, {
      responseType: 'arraybuffer',
      timeout: 5000,
    });
    return Buffer.from(response.data, 'binary');
  } catch (e) {
    console.log('Error descargando logo:', e.message);
    return null;
  }
}

/**
 * Helper para formatear fecha en zona horaria de Colombia (UTC-5)
 * Replicamos la lógica de email.js para consistencia y robustez en VPS.
 */
const formatColombiaDate = (dateInput, style = 'full') => {
  const date = new Date(dateInput);
  if (isNaN(date.getTime())) return dateInput;
  const COLOMBIA_OFFSET = -5 * 60 * 60 * 1000;
  const colombiaTime = new Date(date.getTime() + COLOMBIA_OFFSET);
  return colombiaTime.toLocaleString('es-CO', { 
    timeZone: 'UTC', 
    dateStyle: style, 
    timeStyle: 'short' 
  });
};

/**
 * Genera un PDF comprobante de pago profesional
 * @param {Object} appointmentData - Datos de la cita
 * @returns {Buffer} Buffer del PDF generado
 */
const generatePaymentReceipt = async (appointmentData) => {
  return new Promise(async (resolve) => {
    // Definición de colores modernos (Tailwind CSS Palette)
    const colors = {
      primary: '#111827',    // Slate 900
      secondary: '#4B5563',  // Slate 600
      accent: '#059669',     // Emerald 600 (Éxito)
      border: '#E5E7EB',     // Gray 200
      bgLight: '#F9FAFB',    // Gray 50
      white: '#FFFFFF'
    };

    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => resolve(Buffer.concat(buffers)));

    const pageWidth = doc.page.width;
    const margin = 40;
    const contentWidth = pageWidth - (margin * 2);

    // === 1. ENCABEZADO Y LOGO ===
    let currentY = 40;
    
    if (appointmentData.businessLogoUrl) {
      const logoBuffer = await downloadImage(appointmentData.businessLogoUrl);
      if (logoBuffer) {
        doc.image(logoBuffer, margin, currentY, { height: 45 });
      }
    }

    // Título principal alineado a la derecha
    doc.fillColor(colors.primary)
       .font('Helvetica-Bold')
       .fontSize(20)
       .text('COMPROBANTE', margin, currentY, { align: 'right' });
    
    doc.fillColor(colors.secondary)
       .font('Helvetica')
       .fontSize(10)
       .text(`Referencia: #${appointmentData.id?.substring(0, 8).toUpperCase()}`, margin, currentY + 22, { align: 'right' });

    currentY += 70;

    // === 2. BLOQUE DE INFORMACIÓN (EMISOR VS RECEPTOR) ===
    // Fondo sutil para la sección de info
    doc.fillColor(colors.bgLight)
       .roundedRect(margin, currentY, contentWidth, 80, 4)
       .fill();

    const colWidth = contentWidth / 2;
    
    // De: (Empresa)
    doc.fillColor(colors.secondary).font('Helvetica-Bold').fontSize(9).text('DE:', margin + 15, currentY + 15);
    doc.fillColor(colors.primary).font('Helvetica-Bold').fontSize(11).text(appointmentData.businessName || 'Mi Negocio', margin + 15, currentY + 28);
    doc.fillColor(colors.secondary).font('Helvetica').fontSize(9).text('Servicios Profesionales', margin + 15, currentY + 42);

    // Para: (Cliente)
    doc.fillColor(colors.secondary).font('Helvetica-Bold').fontSize(9).text('PARA:', margin + colWidth, currentY + 15);
    doc.fillColor(colors.primary).font('Helvetica-Bold').fontSize(11).text(appointmentData.clientName || 'Cliente', margin + colWidth, currentY + 28);
    doc.fillColor(colors.secondary).font('Helvetica').fontSize(9).text(appointmentData.clientEmail || '', margin + colWidth, currentY + 42);
    
    currentY += 100;

    // === 3. TABLA DE DETALLES ===
    // Encabezado de tabla minimalista
    doc.fillColor(colors.primary).font('Helvetica-Bold').fontSize(10);
    doc.text('DESCRIPCIÓN DEL SERVICIO', margin, currentY);
    doc.text('FECHA', margin + 260, currentY);
    doc.text('TOTAL', margin, currentY, { align: 'right' });

    currentY += 15;
    doc.strokeColor(colors.primary).lineWidth(1).moveTo(margin, currentY).lineTo(pageWidth - margin, currentY).stroke();

    // Fila del servicio
    currentY += 15;
    doc.fillColor(colors.primary).font('Helvetica-Bold').fontSize(11)
       .text(appointmentData.serviceName || 'Servicio General', margin, currentY);
    
    doc.fillColor(colors.secondary).font('Helvetica').fontSize(10)
       .text(`Especialista: ${appointmentData.employeeName}`, margin, currentY + 15);

    doc.fillColor(colors.primary).text(formatColombiaDate(appointmentData.startTime, 'short'), margin + 260, currentY);

    const priceFormatted = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(appointmentData.price || 0);
    doc.fillColor(colors.primary).font('Helvetica-Bold').fontSize(12).text(priceFormatted, margin, currentY, { align: 'right' });

    currentY += 60;

    // === 4. RESUMEN Y SELLO DE PAGO ===
    doc.strokeColor(colors.border).lineWidth(0.5).moveTo(margin, currentY).lineTo(pageWidth - margin, currentY).stroke();
    currentY += 20;

    // Caja de Estado "PAGADO"
    doc.fillColor('#D1FAE5') // Verde muy claro
       .roundedRect(margin, currentY, 80, 22, 11)
       .fill();
    doc.fillColor(colors.accent)
       .font('Helvetica-Bold')
       .fontSize(9)
       .text('PAGADO', margin + 18, currentY + 7);

    // Total final destacado
    doc.fillColor(colors.secondary).font('Helvetica').fontSize(10).text('Total Recibido:', margin + 250, currentY + 2);
    doc.fillColor(colors.primary).font('Helvetica-Bold').fontSize(18).text(priceFormatted, margin, currentY - 5, { align: 'right' });

    // === 5. PIE DE PÁGINA ===
    const footerY = doc.page.height - 80;
    
    // Línea de corte o separación
    doc.dash(5, { space: 5 }).strokeColor(colors.border).moveTo(margin, footerY).lineTo(pageWidth - margin, footerY).stroke().undash();

    doc.fillColor(colors.secondary)
       .font('Helvetica')
       .fontSize(8)
       .text('Gracias por su confianza.', margin, footerY + 15, { align: 'center' })
       .fillColor('#9CA3AF')
       .text(`Comprobante generado automáticamente el ${formatColombiaDate(new Date())}`, margin, footerY + 28, { align: 'center' });

    doc.end();
  });
};

module.exports = { generatePaymentReceipt };
