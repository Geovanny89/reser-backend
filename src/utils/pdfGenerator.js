const PDFDocument = require('pdfkit');

/**
 * Genera un PDF comprobante de pago para una cita completada
 * @param {Object} appointmentData - Datos de la cita
 * @returns {Buffer} Buffer del PDF generado
 */
const generatePaymentReceipt = (appointmentData) => {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const buffers = [];

    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => {
      const pdfData = Buffer.concat(buffers);
      resolve(pdfData);
    });

    // Configuración de fuentes y colores
    const primaryColor = '#4f46e5';
    const secondaryColor = '#7c3aed';
    const textColor = '#374151';
    const lightGray = '#f3f4f6';

    // Encabezado
    doc.fillColor(primaryColor)
       .rect(0, 0, doc.page.width, 80)
       .fill();

    // Logo y nombre del negocio
    doc.fillColor('white')
       .fontSize(20)
       .font('Helvetica-Bold')
       .text(appointmentData.businessName || 'Negocio', 50, 30, { align: 'left' });

    doc.fontSize(14)
       .font('Helvetica')
       .text('Comprobante de Pago', 50, 55, { align: 'left' });

    // Si hay logo del negocio, intentarlo agregar
    if (appointmentData.businessLogo) {
      try {
        // Aquí podríamos agregar el logo si está disponible
        // doc.image(appointmentData.businessLogo, doc.page.width - 150, 20, { width: 100, height: 40 });
      } catch (e) {
        console.log('No se pudo cargar el logo del negocio:', e);
      }
    }

    // Espacio blanco
    doc.fillColor(textColor);

    // Información del negocio
    doc.fontSize(16)
       .font('Helvetica-Bold')
       .text('Información del Negocio', 50, 110);

    doc.fontSize(12)
       .font('Helvetica')
       .text(`Negocio: ${appointmentData.businessName}`, 50, 135)
       .text(`Dirección: ${appointmentData.businessAddress || 'No especificada'}`, 50, 155)
       .text(`Teléfono: ${appointmentData.businessPhone || 'No especificado'}`, 50, 175)
       .text(`NIT: ${appointmentData.businessNit || 'No especificado'}`, 50, 195);

    // Línea separadora
    doc.strokeColor('#e5e7eb')
       .lineWidth(1)
       .moveTo(50, 220)
       .lineTo(doc.page.width - 50, 220)
       .stroke();

    // Información de la cita
    doc.fontSize(16)
       .font('Helvetica-Bold')
       .text('Detalles de la Cita', 50, 240);

    doc.fontSize(12)
       .font('Helvetica')
       .text(`Número de comprobante: #${appointmentData.id.substring(0, 8).toUpperCase()}`, 50, 265)
       .text(`Fecha de emisión: ${new Date().toLocaleString('es-CO', { dateStyle: 'full', timeStyle: 'short' })}`, 50, 285)
       .text(`Cliente: ${appointmentData.clientName}`, 50, 305)
       .text(`Email cliente: ${appointmentData.clientEmail || 'No especificado'}`, 50, 325)
       .text(`Teléfono cliente: ${appointmentData.clientPhone || 'No especificado'}`, 50, 345);

    // Tabla de servicios
    const tableTop = 380;
    const tableLeft = 40;
    const tableRight = doc.page.width - 40;
    const tableWidth = tableRight - tableLeft;

    // Encabezado de tabla
    doc.fillColor(primaryColor)
       .rect(tableLeft, tableTop, tableWidth, 30)
       .fill();

    doc.fillColor('white')
       .font('Helvetica-Bold')
       .fontSize(12)
       .text('Servicio', tableLeft + 10, tableTop + 10)
       .text('Profesional', tableLeft + 130, tableTop + 10)
       .text('Fecha/Hora', tableLeft + 250, tableTop + 10)
       .text('Precio', tableLeft + 420, tableTop + 10);

    // Contenido de la tabla
    doc.fillColor(textColor)
       .font('Helvetica')
       .fontSize(11);

    let currentY = tableTop + 40;
    const rowHeight = 25;

    // Fila del servicio
    if (currentY % 2 === 0) {
      doc.fillColor(lightGray)
         .rect(tableLeft, currentY, tableWidth, rowHeight)
         .fill();
      doc.fillColor(textColor);
    }

    // Ajustar texto para que no se corte
    const serviceName = appointmentData.serviceName || 'Servicio';
    const employeeName = appointmentData.employeeName || 'Profesional';
    const dateTime = new Date(appointmentData.startTime).toLocaleString('es-CO', { 
      dateStyle: 'short', 
      timeStyle: 'short' 
    });
    const price = new Intl.NumberFormat('es-CO', { 
      style: 'currency', 
      currency: 'COP', 
      maximumFractionDigits: 0 
    }).format(appointmentData.price || 0);

    doc.text(serviceName, tableLeft + 10, currentY + 7, { width: 110, ellipsis: true })
       .text(employeeName, tableLeft + 130, currentY + 7, { width: 110, ellipsis: true })
       .text(dateTime, tableLeft + 250, currentY + 7, { width: 160, ellipsis: true })
       .text(price, tableLeft + 420, currentY + 7, { width: tableWidth - 430, align: 'right' });

    currentY += rowHeight;

    // Línea final de tabla
    doc.strokeColor('#e5e7eb')
       .lineWidth(1)
       .moveTo(tableLeft, currentY)
       .lineTo(tableRight, currentY)
       .stroke();

    // Total
    currentY += 20;
    doc.font('Helvetica-Bold')
       .fontSize(14)
       .text('TOTAL:', tableLeft + 350, currentY)
       .fillColor(primaryColor)
       .text(new Intl.NumberFormat('es-CO', { 
         style: 'currency', 
         currency: 'COP', 
         maximumFractionDigits: 0 
       }).format(appointmentData.price || 0), tableLeft + 420, currentY, { width: tableWidth - 430, align: 'right' });

    // Métodos de pago
    currentY += 40;
    doc.fillColor(textColor)
       .font('Helvetica-Bold')
       .fontSize(12)
       .text('Método de pago:', tableLeft, currentY);

    doc.font('Helvetica')
       .text(appointmentData.paymentMethod || 'Efectivo', tableLeft + 100, currentY);

    // Notas adicionales
    if (appointmentData.notes) {
      currentY += 30;
      doc.font('Helvetica-Bold')
         .fontSize(12)
         .text('Notas:', tableLeft, currentY);

      doc.font('Helvetica')
         .fontSize(11)
         .text(appointmentData.notes, tableLeft, currentY + 20, { 
           width: tableWidth, 
           align: 'left' 
         });
    }

    // Pie de página
    // Verificar si necesitamos nueva página
    if (currentY > doc.page.height - 120) {
      doc.addPage();
      currentY = 50; // Reiniciar posición en nueva página
    }

    const footerY = Math.min(currentY + 40, doc.page.height - 80);
    
    doc.strokeColor('#e5e7eb')
       .lineWidth(1)
       .moveTo(40, footerY - 20)
       .lineTo(doc.page.width - 40, footerY - 20)
       .stroke();

    doc.fillColor('#6b7280')
       .font('Helvetica')
       .fontSize(10)
       .text('Este comprobante es una constancia de pago del servicio recibido.', 40, footerY, { align: 'center' })
       .text('Para cualquier consulta, contacte al negocio directamente.', 40, footerY + 15, { align: 'center' })
       .text('Generado mediante KDice POS - Sistema de Gestión de Citas', 40, footerY + 30, { align: 'center' })
       .text('Este documento NO sustituye una factura electrónica válida.', 40, footerY + 45, { align: 'center', color: '#dc2626', font: 'Helvetica-Bold' });

    // Finalizar el PDF
    doc.end();
  });
};

module.exports = { generatePaymentReceipt };
