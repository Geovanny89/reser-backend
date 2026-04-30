const PDFDocument = require('pdfkit');
const axios = require('axios');

/**
 * Helper para descargar imagen desde URL (Cloudinary, etc) o data URL
 * @param {string} url - URL de la imagen o data URL
 * @returns {Buffer|null} - Buffer de la imagen o null si falla
 */
async function downloadImage(url) {
  if (!url) return null;
  try {
    // Si es un data URL (base64), decodificarlo directamente
    if (url.startsWith('data:')) {
      const matches = url.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
      if (matches && matches.length === 3) {
        const type = matches[1];
        const data = matches[2];
        return Buffer.from(data, 'base64');
      }
      return null;
    }

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
    console.log('Error descargando imagen:', e.message);
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
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const buffers = [];

    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => {
      const pdfData = Buffer.concat(buffers);
      resolve(pdfData);
    });

    // Colores profesionales y sobrios
    const colors = {
      primary: '#374151',     // Gris oscuro
      secondary: '#6b7280',   // Gris medio
      light: '#f3f4f6',      // Gris claro
      accent: '#10b981',      // Verde éxito
      white: '#ffffff',
      black: '#1f2937',
    };

    const pageWidth = doc.page.width;
    const margin = 50;

    // === HEADER LIMPIO ===
    // Intentar cargar logo desde Cloudinary
    let hasLogo = false;
    if (appointmentData.businessLogoUrl) {
      const logoBuffer = await downloadImage(appointmentData.businessLogoUrl);
      if (logoBuffer) {
        try {
          const logoX = margin;
          const logoY = 25;
          const logoSize = 50;
          const radius = 8;
          
          // Fondo blanco limpio para el logo (mejor que gris)
          doc.fillColor('#ffffff')
             .roundedRect(logoX - 2, logoY - 2, logoSize + 4, logoSize + 4, radius, radius)
             .fill()
             .strokeColor('#e5e5e5')
             .lineWidth(1)
             .roundedRect(logoX - 2, logoY - 2, logoSize + 4, logoSize + 4, radius, radius)
             .stroke();
          
          // Logo centrado sin recortar - mantiene proporción original
          doc.image(logoBuffer, logoX, logoY, { 
            width: logoSize, 
            height: logoSize,
            fit: [logoSize, logoSize],
            align: 'center',
            valign: 'center'
          });
          hasLogo = true;
        } catch (e) {
          console.log('Error agregando logo al PDF:', e.message);
        }
      }
    }

    // Nombre del negocio - alineado a la derecha del logo
    const titleX = hasLogo ? margin + 70 : margin;
    const titleY = hasLogo ? 30 : 40;
    
    doc.fillColor(colors.primary)
       .font('Helvetica-Bold')
       .fontSize(24)
       .text(appointmentData.businessName || 'Mi Negocio', titleX, titleY);

    // Determinar tipo de documento
    const isTechnicalService = appointmentData.isTechnicalService || false;
    const documentTitle = isTechnicalService ? 'Reporte de Servicio' : 'Comprobante de Pago';
    const documentSubtitle = isTechnicalService ? 'Confirmación de Visita Profesional' : 'Soporte de Transacción';

    // Título del documento
    doc.fillColor(colors.secondary)
       .font('Helvetica')
       .fontSize(12)
       .text(documentTitle, titleX, titleY + 25);

    // Fecha de emisión (movida más a la izquierda para evitar corte)
    doc.fillColor(colors.secondary)
       .fontSize(10)
       .text(`Emitido: ${formatColombiaDate(new Date())}`, pageWidth - 150, titleY + 25, { align: 'left' });

    // Línea separadora elegante - más abajo para dar espacio
    doc.strokeColor(colors.light)
       .lineWidth(1)
       .moveTo(margin, 100)
       .lineTo(pageWidth - margin, 100)
       .stroke();

    // === SECCIÓN: INFORMACIÓN DEL CLIENTE / VISITA ===
    let y = 120;
    doc.fillColor(colors.primary)
       .font('Helvetica-Bold')
       .fontSize(14)
       .text(isTechnicalService ? 'Información de la Visita' : 'Información del Cliente', margin, y);

    y += 20;
    doc.fillColor(colors.black)
       .font('Helvetica')
       .fontSize(11);
    
    doc.text(`Cliente: ${appointmentData.clientName || 'No especificado'}`, margin, y);
    y += 18;
    doc.text(`Profesional: ${appointmentData.employeeName || 'No especificado'}`, margin, y);
    y += 18;
    doc.text(`Teléfono: ${appointmentData.clientPhone || 'No especificado'}`, margin, y);

    // === SECCIÓN: DETALLES DEL SERVICIO ===
    y += 30;
    doc.fillColor(colors.primary)
       .font('Helvetica-Bold')
       .fontSize(14)
       .text('Detalles del Servicio', margin, y);

    // Tabla de servicios con diseño limpio
    const tableTop = y + 25;
    const tableLeft = margin;
    const tableRight = pageWidth - margin;
    const tableWidth = tableRight - tableLeft;

    // Header de tabla
    doc.fillColor(colors.light)
       .rect(tableLeft, tableTop, tableWidth, 28)
       .fill();

    doc.fillColor(colors.primary)
       .font('Helvetica-Bold')
       .fontSize(10)
       .text('SERVICIO', tableLeft + 12, tableTop + 9)
       .text('FECHA/HORA', tableLeft + 200, tableTop + 9)
       .text('PROFESIONAL', tableLeft + 320, tableTop + 9);
    
    // Solo mostrar columna VALOR si no es servicio técnico
    if (!isTechnicalService) {
      doc.text('VALOR', tableLeft + 450, tableTop + 9);
    }

    // Fila de datos
    const rowY = tableTop + 28;
    doc.fillColor(colors.white)
       .rect(tableLeft, rowY, tableWidth, 30)
       .fill();

    doc.fillColor(colors.black)
       .font('Helvetica')
       .fontSize(10)
       .text(appointmentData.serviceName || 'Servicio', tableLeft + 12, rowY + 10, { width: 180, ellipsis: true })
       .text(formatColombiaDate(appointmentData.startTime, 'short'), tableLeft + 200, rowY + 10)
       .text(appointmentData.employeeName || 'Profesional', tableLeft + 320, rowY + 10, { width: 120, ellipsis: true });
    
    // Solo mostrar precio si no es servicio técnico
    if (!isTechnicalService) {
      doc.text(new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(appointmentData.price || 0), 
               tableLeft + 450, rowY + 10);
    }

    // Línea inferior de tabla
    let tableBottom = rowY + 30;

    // --- AGREGAR DESCRIPCIÓN DEL SERVICIO (SI EXISTE) ---
    if (appointmentData.serviceDescription) {
      doc.fillColor('#f9fafb') // Fondo gris muy claro para la descripción
         .rect(tableLeft, tableBottom, tableWidth, 40)
         .fill();

      doc.fillColor(colors.primary)
         .font('Helvetica-Bold')
         .fontSize(9)
         .text('DESCRIPCIÓN:', tableLeft + 12, tableBottom + 10);

      doc.fillColor(colors.secondary)
         .font('Helvetica')
         .fontSize(9)
         .text(appointmentData.serviceDescription, tableLeft + 85, tableBottom + 10, { width: tableWidth - 100 });

      tableBottom += 40;
    }

    doc.strokeColor(colors.light)
       .lineWidth(0.5)
       .moveTo(tableLeft, tableBottom)
       .lineTo(tableRight, tableBottom)
       .stroke();

    // === CARGO ADICIONAL (si existe) ===
    const additionalAmt = parseFloat(appointmentData.additionalAmount || 0);
    if (additionalAmt > 0) {
      doc.fillColor('#fffbeb').rect(tableLeft, tableBottom, tableWidth, 35).fill();
      doc.fillColor(colors.primary).font('Helvetica-Bold').fontSize(10)
         .text('CARGO ADICIONAL:', tableLeft + 12, tableBottom + 10);
      doc.fillColor(colors.secondary).font('Helvetica').fontSize(9)
         .text(appointmentData.additionalNote || 'Concepto adicional', tableLeft + 120, tableBottom + 10);
      doc.fillColor('#d97706').font('Helvetica-Bold').fontSize(10)
         .text(new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(additionalAmt),
               tableLeft + 450, tableBottom + 10);
      tableBottom += 35;
      doc.strokeColor(colors.light).lineWidth(0.5)
         .moveTo(tableLeft, tableBottom).lineTo(tableRight, tableBottom).stroke();
    }

    // === INSUMOS UTILIZADOS (si existe workReport con partsUsed) ===
    if (appointmentData.workReport && appointmentData.workReport.partsUsed && appointmentData.workReport.partsUsed.length > 0) {
      doc.fillColor(colors.primary)
         .font('Helvetica-Bold')
         .fontSize(12)
         .text('Insumos Utilizados', margin, tableBottom + 15);

      const insumosY = tableBottom + 35;
      doc.fillColor(colors.light)
         .rect(tableLeft, insumosY, tableWidth, 25)
         .fill();

      doc.fillColor(colors.primary)
         .font('Helvetica-Bold')
         .fontSize(9)
         .text('INSUMO', tableLeft + 12, insumosY + 8)
         .text('CANTIDAD', tableLeft + 300, insumosY + 8)
         .text('UNIDAD', tableLeft + 400, insumosY + 8);

      let insumosRowY = insumosY + 25;
      appointmentData.workReport.partsUsed.forEach((part) => {
        doc.fillColor(colors.white)
           .rect(tableLeft, insumosRowY, tableWidth, 22)
           .fill();

        doc.fillColor(colors.black)
           .font('Helvetica')
           .fontSize(9)
           .text(part.name || 'Sin nombre', tableLeft + 12, insumosRowY + 7, { width: 280, ellipsis: true })
           .text(String(part.quantity || 0), tableLeft + 300, insumosRowY + 7)
           .text(part.unit || 'N/A', tableLeft + 400, insumosRowY + 7);

        insumosRowY += 22;
      });

      tableBottom = insumosRowY;
      doc.strokeColor(colors.light).lineWidth(0.5)
         .moveTo(tableLeft, tableBottom).lineTo(tableRight, tableBottom).stroke();
    }

    // === DIAGNÓSTICO (si existe workReport con diagnosis) ===
    if (appointmentData.workReport && appointmentData.workReport.diagnosis) {
      doc.fillColor('#f0f9ff')
         .rect(tableLeft, tableBottom + 10, tableWidth, 40)
         .fill();

      doc.fillColor(colors.primary)
         .font('Helvetica-Bold')
         .fontSize(10)
         .text('DIAGNÓSTICO:', tableLeft + 12, tableBottom + 20);

      doc.fillColor(colors.secondary)
         .font('Helvetica')
         .fontSize(9)
         .text(appointmentData.workReport.diagnosis, tableLeft + 85, tableBottom + 20, { width: tableWidth - 100 });

      tableBottom += 50;
      doc.strokeColor(colors.light).lineWidth(0.5)
         .moveTo(tableLeft, tableBottom).lineTo(tableRight, tableBottom).stroke();
    }

    // === FOTOS DE EVIDENCIA (si existe workEvidences) ===
    const photos = Array.isArray(appointmentData.workEvidences) ? appointmentData.workEvidences : appointmentData.workEvidences?.photos || [];
    if (photos.length > 0) {
      doc.fillColor(colors.primary)
         .font('Helvetica-Bold')
         .fontSize(12)
         .text('Evidencias Fotográficas', margin, tableBottom + 15);

      const photosY = tableBottom + 35;
      const photoSize = 80;
      const photoGap = 15;
      const photosPerRow = Math.floor(tableWidth / (photoSize + photoGap));

      let currentX = tableLeft;
      let currentY = photosY;

      for (let i = 0; i < photos.length; i++) {
        const photo = photos[i];
        const photoUrl = typeof photo === 'string' ? photo : photo.url;
        try {
          const photoBuffer = await downloadImage(photoUrl);
          if (photoBuffer) {
            doc.fillColor('#f3f4f6')
               .rect(currentX, currentY, photoSize, photoSize)
               .fill()
               .strokeColor(colors.light)
               .lineWidth(0.5)
               .rect(currentX, currentY, photoSize, photoSize)
               .stroke();

            doc.image(photoBuffer, currentX, currentY, {
              width: photoSize,
              height: photoSize,
              fit: [photoSize, photoSize]
            });

            currentX += photoSize + photoGap;
            if (currentX + photoSize > tableRight) {
              currentX = tableLeft;
              currentY += photoSize + photoGap;
            }
          }
        } catch (e) {
          console.log('Error agregando foto al PDF:', e.message);
        }
      }

      tableBottom = currentY + photoSize + 10;
      doc.strokeColor(colors.light).lineWidth(0.5)
         .moveTo(tableLeft, tableBottom).lineTo(tableRight, tableBottom).stroke();
    }

    // === FIRMA DEL CLIENTE (si existe clientSignature) ===
    if (appointmentData.clientSignature) {
      doc.fillColor(colors.primary)
         .font('Helvetica-Bold')
         .fontSize(12)
         .text('Firma del Cliente', margin, tableBottom + 15);

      const signatureY = tableBottom + 35;
      const signatureWidth = 200;
      const signatureHeight = 80;

      doc.fillColor('#ffffff')
         .rect(tableLeft, signatureY, signatureWidth, signatureHeight)
         .fill()
         .strokeColor(colors.light)
         .lineWidth(1)
         .rect(tableLeft, signatureY, signatureWidth, signatureHeight)
         .stroke();

      try {
        const signatureBuffer = await downloadImage(appointmentData.clientSignature);
        if (signatureBuffer) {
          doc.image(signatureBuffer, tableLeft + 5, signatureY + 5, {
            width: signatureWidth - 10,
            height: signatureHeight - 10,
            fit: [signatureWidth - 10, signatureHeight - 10]
          });
        }
      } catch (e) {
        console.log('Error agregando firma al PDF:', e.message);
      }

      doc.fillColor(colors.secondary)
         .font('Helvetica')
         .fontSize(9)
         .text(`Firmado por: ${appointmentData.clientSignatureName || 'Cliente'}`, tableLeft, signatureY + signatureHeight + 10);

      if (appointmentData.clientSignatureDate) {
        doc.text(`Fecha: ${formatColombiaDate(appointmentData.clientSignatureDate, 'short')}`, tableLeft, signatureY + signatureHeight + 25);
      }

      tableBottom = signatureY + signatureHeight + 40;
      doc.strokeColor(colors.light).lineWidth(0.5)
         .moveTo(tableLeft, tableBottom).lineTo(tableRight, tableBottom).stroke();
    }

    // === TOTAL PAGADO - Solo para comprobantes de pago ===
    if (!isTechnicalService) {
      y = tableBottom + 25;
      
      // Caja de total con fondo sutil
      const totalBoxWidth = 180;
      const totalBoxX = pageWidth - margin - totalBoxWidth;
      doc.fillColor('#f8f9fa')
         .roundedRect(totalBoxX, y - 5, totalBoxWidth, 35, 6, 6)
         .fill()
         .strokeColor(colors.light)
         .lineWidth(0.5)
         .roundedRect(totalBoxX, y - 5, totalBoxWidth, 35, 6, 6)
         .stroke();
      
      doc.fillColor(colors.secondary)
         .font('Helvetica')
         .fontSize(10)
         .text('TOTAL PAGADO:', totalBoxX + 10, y + 5);
      
      const basePrice = parseFloat(appointmentData.price || 0);
      const totalAmount = basePrice + additionalAmt;
      
      doc.fillColor(colors.accent)
         .font('Helvetica-Bold')
         .fontSize(16)
         .text(new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(totalAmount), 
               totalBoxX + 10, y + 18);

      y += 50;
    } else {
      y = tableBottom + 20;
    }
    if (appointmentData.notes) {
      doc.fillColor(colors.primary)
         .font('Helvetica-Bold')
         .fontSize(11)
         .text('Notas:', margin, y);
      
      y += 15;
      doc.fillColor(colors.secondary)
         .font('Helvetica')
         .fontSize(10)
         .text(appointmentData.notes, margin, y, { width: tableWidth });
      
      y += 20;
    }

    // === FOOTER ===
    // Footer justo después del contenido, no al final de la página
    const footerY = y + 20;
    
    // Línea decorativa
    doc.strokeColor(colors.light)
       .lineWidth(0.5)
       .moveTo(margin, footerY)
       .lineTo(pageWidth - margin, footerY)
       .stroke();

    // Texto del footer
    const footerText1 = isTechnicalService 
      ? 'Este documento confirma la realización de su servicio.' 
      : 'Este documento certifica que el pago fue recibido.';
    const footerText2 = isTechnicalService 
      ? 'Conserve este reporte para cualquier reclamación.' 
      : 'Conserve este comprobante para cualquier reclamación.';
    const referenceLabel = isTechnicalService ? 'N° Reporte de Servicio' : 'N° Comprobante';
    
    doc.fillColor(colors.secondary)
       .font('Helvetica')
       .fontSize(9)
       .text(footerText1, margin, footerY + 10, { align: 'center', width: pageWidth - margin * 2 })
       .text(footerText2, margin, footerY + 22, { align: 'center', width: pageWidth - margin * 2 })
       .text(`${referenceLabel}: #${appointmentData.id?.substring(0, 8).toUpperCase() || 'N/A'}`, margin, footerY + 34, { align: 'center', width: pageWidth - margin * 2 });

    // Finalizar el PDF
    doc.end();
  });
};

module.exports = { generatePaymentReceipt };
