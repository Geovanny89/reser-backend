const nodemailer = require('nodemailer');

// Crear transporter de Nodemailer
// Soporta Gmail, SMTP genérico, Ethereal (pruebas)
const createTransporter = () => {
  const host    = process.env.EMAIL_HOST;
  const port    = parseInt(process.env.EMAIL_PORT || '587');
  const user    = process.env.EMAIL_USER;
  const pass    = process.env.EMAIL_PASS;
  const service = process.env.EMAIL_SERVICE; // 'gmail', 'outlook', etc.

  if (!user || !pass) {
    console.warn('[Email] ⚠️  Credenciales de email no configuradas. Las notificaciones están desactivadas.');
    return null;
  }

  if (service) {
    return nodemailer.createTransport({ service, auth: { user, pass } });
  }

  return nodemailer.createTransport({
  host: process.env.EMAIL_HOST || "smtp.hostinger.com",
  port: parseInt(process.env.EMAIL_PORT || "465"),
  secure: true,
  auth: { user, pass },
  tls: { rejectUnauthorized: false },
});
};

const transporter = createTransporter();

const FROM_NAME  = process.env.EMAIL_FROM_NAME  || 'KDice POS';
const FROM_EMAIL = process.env.EMAIL_USER        || 'noreply@kdice.app';

// ============================================================
// PLANTILLA BASE HTML
// ============================================================
const baseTemplate = (content, businessName = 'KDice POS') => `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${businessName}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; background: #f1f5f9; color: #0f172a; }
    .wrapper { max-width: 600px; margin: 0 auto; padding: 24px 16px; }
    .header { background: linear-gradient(135deg, #4f46e5, #7c3aed); border-radius: 12px 12px 0 0; padding: 32px 32px 24px; text-align: center; }
    .header h1 { color: #fff; font-size: 22px; font-weight: 800; letter-spacing: -.3px; }
    .header p { color: rgba(255,255,255,.8); font-size: 13px; margin-top: 6px; }
    .body { background: #fff; padding: 32px; border-left: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0; }
    .footer { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 0 0 12px 12px; padding: 20px 32px; text-align: center; font-size: 12px; color: #94a3b8; }
    .info-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px 24px; margin: 16px 0; }
    .info-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #e2e8f0; font-size: 14px; gap: 16px; }
    .info-row:last-child { border-bottom: none; }
    .info-label { color: #64748b; font-weight: 500; min-width: 140px; }
    .info-value { font-weight: 700; color: #0f172a; flex: 1; }
    .badge { display: inline-block; padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 700; }
    .badge-success { background: #d1fae5; color: #065f46; }
    .badge-warning { background: #fef3c7; color: #92400e; }
    .badge-info    { background: #dbeafe; color: #1e40af; }
    .money { font-size: 28px; font-weight: 800; color: #4f46e5; }
    .btn { display: inline-block; background: #4f46e5; color: #fff; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 14px; margin: 16px 0; }
    .divider { height: 1px; background: #e2e8f0; margin: 20px 0; }
    h2 { font-size: 18px; font-weight: 700; color: #0f172a; margin-bottom: 8px; }
    p { font-size: 14px; line-height: 1.6; color: #374151; margin-bottom: 12px; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1> ${businessName}</h1>
      <p>Sistema de gestión de citas · KDice POS</p>
    </div>
    <div class="body">
      ${content}
    </div>
    <div class="footer">
      <p>Este correo fue enviado automáticamente por KDice POS.</p>
      <p>Si tienes dudas, contacta a tu negocio directamente.</p>
    </div>
  </div>
</body>
</html>
`;

// ============================================================
// PLANTILLAS ESPECÍFICAS
// ============================================================

const templates = {

  // Confirmación de cita para el cliente
  appointmentConfirmation: ({ clientName, businessName, serviceName, employeeName, startTime, price }) => ({
    subject: `✅ Cita confirmada en ${businessName}`,
    html: baseTemplate(`
      <h2>¡Tu cita está confirmada!</h2>
      <p>Hola <strong>${clientName}</strong>, tu cita ha sido registrada exitosamente.</p>
      <div class="info-box">
        <div class="info-row">
          <span class="info-label">Negocio</span>
          <span class="info-value">${businessName}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Servicio</span>
          <span class="info-value">${serviceName}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Profesional</span>
          <span class="info-value">${employeeName}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Fecha y hora</span>
          <span class="info-value">${new Date(startTime).toLocaleString('es-CO', { dateStyle: 'full', timeStyle: 'short' })}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Precio</span>
          <span class="info-value" style="color:#10b981">${new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(price)}</span>
        </div>
      </div>
      <p>Por favor llega 5 minutos antes de tu cita. Si necesitas cancelar, hazlo con anticipación.</p>
      <span class="badge badge-success">✅ Confirmada</span>
    `, businessName),
  }),

  // Recordatorio de cita (1 hora antes)
  appointmentReminder: ({ clientName, businessName, serviceName, employeeName, startTime }) => ({
    subject: `⏰ Tu cita comienza en 1 hora — ${businessName}`,
    html: baseTemplate(`
      <h2>¡Tu cita es en 1 hora!</h2>
      <p>Hola <strong>${clientName}</strong>, te recordamos que en <strong>1 hora</strong> tienes una cita programada.</p>
      <div class="info-box">
        <div class="info-row">
          <span class="info-label">Negocio</span>
          <span class="info-value">${businessName}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Servicio</span>
          <span class="info-value">${serviceName}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Profesional</span>
          <span class="info-value">${employeeName}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Fecha y hora</span>
          <span class="info-value">${new Date(startTime).toLocaleString('es-CO', { dateStyle: 'full', timeStyle: 'short' })}</span>
        </div>
      </div>
      <p>Por favor llega 5 minutos antes de tu cita. Si necesitas cancelar, hazlo con anticipación.</p>
      <span class="badge badge-warning">⏰ En 1 hora</span>
    `, businessName),
  }),

  // Resumen de pagos al empleado
  paymentSummary: ({ employeeName, businessName, month, totalEarned, appointmentsCount }) => ({
    subject: `💰 Resumen de pagos — ${month} · ${businessName}`,
    html: baseTemplate(`
      <h2>Resumen de comisiones</h2>
      <p>Hola <strong>${employeeName}</strong>, aquí está tu resumen de ganancias del período.</p>
      <div class="divider"></div>
      <div style="text-align:center;padding:20px 0">
        <div style="font-size:13px;color:#64748b;margin-bottom:8px">Total ganado en ${month}</div>
        <div class="money">${new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(totalEarned)}</div>
      </div>
      <div class="info-box">
        <div class="info-row">
          <span class="info-label">Negocio</span>
          <span class="info-value">${businessName}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Período</span>
          <span class="info-value">${month}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Citas completadas</span>
          <span class="info-value">${appointmentsCount}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Total a cobrar</span>
          <span class="info-value" style="color:#10b981">${new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(totalEarned)}</span>
        </div>
      </div>
      <p>Para ver el detalle completo de tus citas, ingresa al sistema con tu cuenta.</p>
      <span class="badge badge-success">✅ Período cerrado</span>
    `, businessName),
  }),

  // Nueva cita para el negocio (admin)
  newAppointmentAdmin: ({ businessName, clientName, serviceName, employeeName, startTime }) => ({
    subject: `📋 Nueva cita registrada en ${businessName}`,
    html: baseTemplate(`
      <h2>Nueva cita registrada</h2>
      <p>Se ha registrado una nueva cita en tu negocio.</p>
      <div class="info-box">
        <div class="info-row">
          <span class="info-label">Cliente</span>
          <span class="info-value">${clientName}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Servicio</span>
          <span class="info-value">${serviceName}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Empleado asignado</span>
          <span class="info-value">${employeeName}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Fecha y hora</span>
          <span class="info-value">${new Date(startTime).toLocaleString('es-CO', { dateStyle: 'full', timeStyle: 'short' })}</span>
        </div>
      </div>
      <span class="badge badge-info">📋 Pendiente de confirmación</span>
    `, businessName),
  }),

  // Credenciales de nuevo empleado
  employeeWelcome: ({ employeeName, businessName, email, tempPassword, loginUrl }) => ({
    subject: `👋 Bienvenido al equipo de ${businessName}`,
    html: baseTemplate(`
      <h2>¡Bienvenido al equipo!</h2>
      <p>Hola <strong>${employeeName}</strong>, has sido registrado como empleado en <strong>${businessName}</strong>.</p>
      <div class="info-box">
        <div class="info-row">
          <span class="info-label">Tu correo</span>
          <span class="info-value">${email}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Contraseña temporal</span>
          <span class="info-value" style="font-family:monospace;font-size:16px;color:#4f46e5">${tempPassword}</span>
        </div>
      </div>
      <p style="color:#ef4444;font-weight:600">⚠️ Por seguridad, cambia tu contraseña al iniciar sesión por primera vez.</p>
      ${loginUrl ? `<a href="${loginUrl}" class="btn">Iniciar sesión ahora</a>` : ''}
    `, businessName),
  }),

  // Comprobante de pago con PDF adjunto
  paymentReceipt: ({ clientName, businessName, serviceName, startTime, price, receiptNumber }) => ({
    subject: `🧾 Comprobante de pago — ${businessName}`,
    html: baseTemplate(`
      <h2>¡Gracias por tu visita!</h2>
      <p>Hola <strong>${clientName}</strong>, tu pago ha sido procesado exitosamente.</p>
      <div class="info-box">
        <div class="info-row">
          <span class="info-label">Negocio</span>
          <span class="info-value">${businessName}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Servicio</span>
          <span class="info-value">${serviceName}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Fecha de atención</span>
          <span class="info-value">${new Date(startTime).toLocaleString('es-CO', { dateStyle: 'full', timeStyle: 'short' })}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Monto pagado</span>
          <span class="info-value" style="color:#10b981">${new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(price)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">N° de comprobante</span>
          <span class="info-value" style="font-family:monospace;color:#4f46e5">#${receiptNumber}</span>
        </div>
      </div>
      <p>Adjuntamos tu comprobante de pago en formato PDF para tu registro.</p>
      <p>Por favor conserva este documento para cualquier consulta o garantía del servicio.</p>
      <span class="badge badge-success">✅ Pagado</span>
    `, businessName),
  }),

};

// ============================================================
// FUNCIÓN PRINCIPAL DE ENVÍO
// ============================================================
const sendEmail = async (to, templateName, data, attachments = []) => {
  if (!transporter) {
    console.log(`[Email] Simulando envío a ${to} — template: ${templateName}`);
    return { simulated: true, to, templateName };
  }

  try {
    const template = templates[templateName];
    if (!template) throw new Error(`Template '${templateName}' no existe`);

    const { subject, html } = template(data);

    const mailOptions = {
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to,
      subject,
      html,
      attachments,
    };

    const info = await transporter.sendMail(mailOptions);

    console.log(`[Email] ✅ Enviado a ${to} — ${subject} — ID: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error(`[Email] ❌ Error enviando a ${to}:`, err.message);
    throw err;
  }
};

module.exports = { sendEmail, templates };
