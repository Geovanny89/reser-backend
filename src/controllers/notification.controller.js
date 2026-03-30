const { sendEmail } = require('../config/email');
const { User, Employee, Business, Appointment, Service } = require('../models');

// Enviar resumen de pago a un empleado
exports.sendPaymentSummary = async (req, res) => {
  try {
    const { businessId, employeeName, month, totalEarned, appointmentsCount } = req.body;

    if (!businessId || !employeeName || !month) {
      return res.status(400).json({ error: 'businessId, employeeName y month son requeridos' });
    }

    const business = await Business.findByPk(businessId);
    if (!business) return res.status(404).json({ error: 'Negocio no encontrado' });

    // Buscar el empleado por nombre para obtener su email
    const employee = await Employee.findOne({
      where: { businessId },
      include: [{ model: User, where: {}, attributes: ['name', 'email'] }],
    });

    // Buscar todos los empleados del negocio y filtrar por nombre
    const employees = await Employee.findAll({
      where: { businessId, active: true },
      include: [{ model: User, attributes: ['name', 'email'] }],
    });

    const emp = employees.find(e => e.User?.name === employeeName);
    if (!emp) return res.status(404).json({ error: 'Empleado no encontrado' });

    await sendEmail(emp.User.email, 'paymentSummary', {
      employeeName,
      businessName: business.name,
      month,
      totalEarned: parseFloat(totalEarned),
      appointmentsCount: parseInt(appointmentsCount),
    });

    res.json({ success: true, message: `Resumen enviado a ${emp.User.email}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// Enviar confirmación de cita al cliente
exports.sendAppointmentConfirmation = async (req, res) => {
  try {
    const { appointmentId } = req.body;

    const appt = await Appointment.findByPk(appointmentId, {
      include: [
        { model: Service },
        { model: Employee, include: [{ model: User, attributes: ['name'] }] },
        { model: Business },
      ],
    });

    if (!appt) return res.status(404).json({ error: 'Cita no encontrada' });

    // Obtener email del cliente
    let clientEmail = null;
    if (appt.clientId) {
      const clientUser = await User.findByPk(appt.clientId);
      clientEmail = clientUser?.email;
    }

    if (!clientEmail) {
      return res.status(400).json({ error: 'El cliente no tiene email registrado' });
    }

    await sendEmail(clientEmail, 'appointmentConfirmation', {
      clientName:   appt.clientName,
      businessName: appt.Business?.name,
      serviceName:  appt.Service?.name,
      employeeName: appt.Employee?.User?.name,
      startTime:    appt.startTime,
      price:        appt.Service?.price,
    });

    res.json({ success: true, message: `Confirmación enviada a ${clientEmail}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// Enviar notificación de nueva cita al admin
exports.notifyNewAppointment = async (appointmentId) => {
  try {
    const appt = await Appointment.findByPk(appointmentId, {
      include: [
        { model: Service },
        { model: Employee, include: [{ model: User, attributes: ['name'] }] },
        { model: Business },
      ],
    });
    if (!appt) return;

    const owner = await User.findByPk(appt.Business?.ownerId);
    if (!owner?.email) return;

    await sendEmail(owner.email, 'newAppointmentAdmin', {
      businessName: appt.Business?.name,
      clientName:   appt.clientName,
      serviceName:  appt.Service?.name,
      employeeName: appt.Employee?.User?.name,
      startTime:    appt.startTime,
    });
  } catch (e) {
    console.error('[Notification] Error notificando nueva cita:', e.message);
  }
};

// Enviar credenciales al nuevo empleado
exports.sendEmployeeWelcome = async (req, res) => {
  try {
    const { employeeId } = req.body;

    const emp = await Employee.findByPk(employeeId, {
      include: [
        { model: User, attributes: ['name', 'email'] },
        { model: Business, attributes: ['name'] },
      ],
    });

    if (!emp) return res.status(404).json({ error: 'Empleado no encontrado' });

    const loginUrl = process.env.FRONTEND_URL
      ? `${process.env.FRONTEND_URL}/login`
      : null;

    await sendEmail(emp.User.email, 'employeeWelcome', {
      employeeName: emp.User.name,
      businessName: emp.Business?.name,
      email:        emp.User.email,
      tempPassword: '(La contraseña fue enviada por el administrador)',
      loginUrl,
    });

    res.json({ success: true, message: `Bienvenida enviada a ${emp.User.email}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// Enviar informe mensual completo al dueño del negocio
exports.sendMonthlyReport = async (req, res) => {
  try {
    const { businessId, month } = req.body;
    if (!businessId || !month) {
      return res.status(400).json({ error: 'businessId y month son requeridos' });
    }

    const business = await Business.findByPk(businessId, {
      include: [{ model: User, as: 'owner', foreignKey: 'ownerId', attributes: ['name', 'email'] }],
    });
    if (!business) return res.status(404).json({ error: 'Negocio no encontrado' });

    const owner = await User.findByPk(business.ownerId);
    if (!owner?.email) return res.status(400).json({ error: 'El dueño no tiene email' });

    // Obtener datos del mes
    const { Op } = require('sequelize');
    const start = new Date(month + '-01');
    const end   = new Date(start); end.setMonth(end.getMonth() + 1); end.setDate(0); end.setHours(23, 59, 59, 999);

    const appointments = await Appointment.findAll({
      where: { businessId, status: 'done', startTime: { [Op.between]: [start, end] } },
      include: [{ model: Service }],
    });

    const totalRev = appointments.reduce((s, a) => s + parseFloat(a.Service?.price || 0), 0);
    const fmt = (n) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n);

    const { sendEmail: send } = require('../config/email');
    const { baseTemplate } = require('../config/email');

    // Email personalizado para el reporte mensual
    const nodemailer = require('nodemailer');
    const emailConfig = require('../config/email');

    await emailConfig.sendEmail(owner.email, 'paymentSummary', {
      employeeName: owner.name,
      businessName: business.name,
      month,
      totalEarned: totalRev,
      appointmentsCount: appointments.length,
    });

    res.json({ success: true, message: `Informe mensual enviado a ${owner.email}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
