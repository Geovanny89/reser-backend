/**
 * Handlers HTTP para endpoints de citas
 * Estas funciones son las que se usan directamente en las rutas de Express
 */

const queries = require('./queries');
const actions = require('./actions');
const { getAppointmentById } = require('./queries');
const { updateAppointmentStatus } = require('./actions');
const { Op } = require('sequelize');
const { Employee, Business, Appointment, Service, User, AppointmentEmployee, ClientTag, ClientTagAssignment } = require('../../models');
const { sendCancellationNotification, sendPushNotification } = require('../../services/pushNotificationService');
const { sendEmail } = require('../../config/email');
const { formatDateColombia, formatTimeColombia } = require('./utils');
const { emitAppointmentUpdate } = require('../../services/socketService');

/**
 * GET /appointments/by-business
 */
async function getByBusiness(req, res) {
  try {
    const businessId = req.query.businessId || req.params.businessId;
    if (!businessId) return res.status(400).json({ error: 'businessId es requerido' });

    const { date, startDate, endDate, employeeId } = req.query;
    const appointments = await queries.getAppointmentsByBusiness(businessId, {
      date, startDate, endDate, employeeId
    });

    res.json(appointments);
  } catch (e) {
    console.error('[getByBusiness] Error:', e);
    res.status(500).json({ error: e.message });
  }
}

/**
 * GET /appointments/consolidated
 */
async function getConsolidated(req, res) {
  try {
    const appointments = await queries.getConsolidatedAppointments(req.user.id);
    if (appointments === null) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }
    res.json(appointments);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/**
 * GET /appointments/my-appointments
 */
async function getMyAppointments(req, res) {
  try {
    const emp = await Employee.findOne({ where: { userId: req.user.id } });
    if (!emp) return res.status(404).json({ error: 'Perfil de empleado no encontrado' });

    const appointments = await queries.getEmployeeAppointments(emp.id);
    res.json(appointments);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/**
 * GET /appointments/my-client-appointments
 */
async function getMyClientAppointments(req, res) {
  try {
    const { email } = req.query;
    const clientId = req.user?.id;

    const appointments = await queries.getClientAppointments(clientId, email);
    if (appointments === null) {
      return res.status(400).json({ error: 'Se requiere identificación de cliente' });
    }
    res.json(appointments);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/**
 * POST /appointments
 */
async function create(req, res) {
  try {
    console.log('[Create Appointment] Datos recibidos:', {
      ...req.body,
      user: req.user?.id || 'no auth'
    });

    const appointment = await actions.createAppointment(req.body, req.user);
    res.status(201).json(appointment);
  } catch (e) {
    console.error('[Create Appointment] Error:', e);
    res.status(400).json({ error: e.message });
  }
}

/**
 * PATCH /appointments/:id/status
 */
async function updateStatus(req, res) {
  try {
    const { status, paymentMethod } = req.body;
    const updated = await updateAppointmentStatus(req.params.id, status, req.user, req.body);
    res.json(updated);
  } catch (e) {
    console.error('[updateStatus] Error:', e);
    res.status(400).json({ error: e.message });
  }
}

/**
 * POST /appointments/:id/cancel
 */
async function cancel(req, res) {
  try {
    const { Appointment, Business, Employee, Service, User, Op } = require('../../models');
    const { sendEmail } = require('../../config/email');
    const { emitAppointmentCancelled } = require('../../services/socketService');

    const appt = await Appointment.findByPk(req.params.id);
    if (!appt) return res.status(404).json({ error: 'Cita no encontrada' });
    if (appt.status === 'done') return res.status(400).json({ error: 'No se puede cancelar una cita completada' });
    if (appt.status === 'cancelled') return res.status(400).json({ error: 'La cita ya está cancelada' });

    // Verificar permisos: admin, empleado asignado, o cliente dueño de la cita
    const isAdmin = req.user && (req.user.role === 'admin' || req.user.role === 'admin_suc' || req.user.role === 'superadmin');

    let isEmployee = false;
    if (req.user && req.user.role === 'employee') {
      const emp = await Employee.findOne({ where: { userId: req.user.id } });
      isEmployee = emp && appt.employeeId === emp.id;
    }

    const isOwnerByEmail = req.body.clientEmail && appt.clientEmail === req.body.clientEmail.toLowerCase().trim();
    const isOwnerByClientId = req.user && req.user.role === 'client' && appt.clientId === req.user.id;

    if (!isAdmin && !isEmployee && !isOwnerByEmail && !isOwnerByClientId) {
      return res.status(403).json({ error: 'No tienes permiso para cancelar esta cita' });
    }

    // Restricción de 12 horas solo para CLIENTES
    if (!isAdmin && !isEmployee && (isOwnerByEmail || isOwnerByClientId)) {
      const now = new Date();
      const apptTime = new Date(appt.startTime);

      // Diferencia en milisegundos
      const diffMs = apptTime.getTime() - now.getTime();
      const diffHours = diffMs / (1000 * 60 * 60);

      if (diffHours < 12) {
        return res.status(400).json({
          error: 'No se puede cancelar la cita porque faltan menos de 12 horas. Por favor contacta al dueño del negocio para más información.'
        });
      }
    }

    await appt.update({ status: 'cancelled' });

    // Enviar email al negocio si es cancelación por cliente
    if (!isAdmin && !isEmployee && (isOwnerByEmail || isOwnerByClientId)) {
      try {
        // Buscar la cita completa con relaciones
        const fullAppt = await Appointment.findByPk(req.params.id, {
          include: [
            { model: Service },
            { model: Employee, include: [{ model: User, attributes: ['name'] }] },
            { model: Business }
          ]
        });

        if (fullAppt && fullAppt.Business) {
          const owner = await User.findByPk(fullAppt.Business.ownerId);
          if (owner?.email) {
            await sendEmail(owner.email, 'appointmentCancelled', {
              businessName: String(fullAppt.Business.name || ''),
              clientName: String(fullAppt.clientName || ''),
              serviceName: String(fullAppt.Service?.name || ''),
              employeeName: String(fullAppt.Employee?.User?.name || 'No asignado'),
              startTime: fullAppt.startTime,
              cancelTime: new Date()
            });
          }

          // Enviar push notification al dueño si tiene FCM token
          if (owner?.pushToken) {
            await sendCancellationNotification(owner.pushToken, {
              id: fullAppt.id,
              clientName: String(fullAppt.clientName || ''),
              serviceName: String(fullAppt.Service?.name || ''),
              businessName: String(fullAppt.Business.name || ''),
              startTime: fullAppt.startTime,
            });
          }

          // Enviar push notification al empleado asignado si tiene FCM token
          if (fullAppt.Employee?.User?.pushToken) {
            await sendCancellationNotification(fullAppt.Employee.User.pushToken, {
              id: fullAppt.id,
              clientName: String(fullAppt.clientName || ''),
              serviceName: String(fullAppt.Service?.name || ''),
              businessName: String(fullAppt.Business.name || ''),
              startTime: fullAppt.startTime,
            });
          }
        }
      } catch (emailErr) {
        console.log('[Cancel] Email no enviado:', emailErr.message);
      }
    }

    // Emitir evento SOCKET.IO - Cancelación en tiempo real
    setImmediate(async () => {
      try {
        // Buscar la cita completa para emitir
        const fullAppt = await Appointment.findByPk(req.params.id, {
          include: [
            { model: Service },
            { model: Employee, include: [{ model: User, attributes: ['name'] }] },
            { model: Business }
          ]
        });

        if (fullAppt) {
          const cancelledBy = req.user?.role || 'system';
          await emitAppointmentCancelled(fullAppt, cancelledBy);
          console.log(`[Socket] Cita ${appt.id} cancelación emitida`);
        }
      } catch (socketErr) {
        console.error('[Socket] Error emitiendo cancelación:', socketErr.message);
      }
    });

    res.json({ message: 'Cita cancelada', appt });
  } catch (e) {
    console.error('[Cancel] Error:', e);
    res.status(500).json({ error: e.message });
  }
}

/**
 * PUT /appointments/:id
 */
async function update(req, res) {
  try {
    const appointment = await actions.updateAppointment(req.params.id, req.body);
    res.json(appointment);
  } catch (e) {
    console.error('[Update] Error:', e);
    res.status(400).json({ error: e.message });
  }
}

/**
 * POST /appointments/:id/extend-time
 */
async function extendTime(req, res) {
  try {
    const updated = await actions.extendTime(req.params.id, req.body, req.user);
    res.json({
      success: true,
      appointment: updated
    });
  } catch (e) {
    console.error('[extendTime] Error:', e);
    res.status(500).json({ error: e.message });
  }
}

/**
 * GET /appointments/:id/notes
 */
async function getNotes(req, res) {
  try {
    const appointment = await getAppointmentById(req.params.id, false);
    if (!appointment) return res.status(404).json({ error: 'Cita no encontrada' });

    const { AppointmentNote } = require('../../models');
    const notes = await AppointmentNote.findAll({
      where: { appointmentId: req.params.id },
      order: [['createdAt', 'DESC']]
    });

    res.json(notes);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/**
 * POST /appointments/:id/notes
 */
async function addNote(req, res) {
  try {
    const { content } = req.body;
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Contenido requerido' });
    }

    const appointment = await getAppointmentById(req.params.id, false);
    if (!appointment) return res.status(404).json({ error: 'Cita no encontrada' });

    const { AppointmentNote } = require('../../models');
    const note = await AppointmentNote.create({
      appointmentId: req.params.id,
      authorId: req.user.id,
      authorName: req.user.name || req.user.email,
      content: content.trim()
    });

    res.status(201).json(note);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/**
 * DELETE /appointments/:id/notes/:noteId
 */
async function deleteNote(req, res) {
  try {
    const { AppointmentNote } = require('../../models');
    const note = await AppointmentNote.findOne({
      where: { id: req.params.noteId, appointmentId: req.params.id }
    });

    if (!note) {
      return res.status(404).json({ error: 'Nota no encontrada' });
    }

    await note.destroy();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/**
 * GET /appointments/:id/confirm
 * Client confirma attendance (no auth required - link from email)
 */
async function confirmAttendance(req, res) {
  try {
    const { id } = req.params;

    // Find appointment
    const appt = await Appointment.findByPk(id, {
      include: [
        { model: Service },
        { model: Employee, include: [{ model: User, attributes: ['name', 'pushToken'] }] },
        { model: Business, include: [{ model: User, as: 'Owner', attributes: ['id', 'name', 'pushToken'] }] },
      ],
    });

    if (!appt) return res.status(404).send('<h1>Cita no encontrada</h1>');
    if (appt.status === 'cancelled') return res.status(400).send('<h1>Esta cita ya fue cancelada</h1>');

    // Update confirmation status
    await appt.update({
      confirmed: true,
      confirmedAt: new Date(),
      reminder24hSent: true
    });

    // Send push notification to admin
    const owner = appt.Business?.Owner;
    if (owner?.pushToken) {
      await sendPushNotification(owner.pushToken, {
        title: '✅ Cliente Confirmó Asistencia',
        body: `${appt.clientName} confirmó que asistirá a la cita de ${appt.Service?.name} el ${new Date(appt.startTime).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Bogota' })}`,
      }, {
        type: 'appointment_confirmed',
        appointmentId: appt.id,
        businessId: appt.businessId,
        clientName: appt.clientName,
      });
    }

    // Send confirmation email to client
    let clientEmail = null;
    if (appt.clientId) {
      const clientUser = await User.findByPk(appt.clientId);
      clientEmail = clientUser?.email || null;
    }
    if (!clientEmail && appt.clientEmail) {
      clientEmail = appt.clientEmail;
    }

    if (clientEmail) {
      await sendEmail(clientEmail, 'appointmentConfirmedByClient', {
        clientName: String(appt.clientName || ''),
        businessName: String(appt.Business?.name || ''),
        serviceName: String(appt.Service?.name || ''),
        employeeName: String(appt.Employee?.User?.name || ''),
        startTime: String(appt.startTime || ''),
      }).catch(e => console.error('[Email] Confirmation error:', e.message));
    }

    // HTML de respuesta
    res.send(`
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Asistencia Confirmada</title>
        <style>
          body { font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f8fafc; color: #1e293b; }
          .card { background: white; padding: 2rem; border-radius: 1rem; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); text-align: center; max-width: 400px; }
          .icon { font-size: 3rem; margin-bottom: 1rem; }
          h1 { margin: 0 0 0.5rem; font-size: 1.5rem; color: #10b981; }
          p { margin: 0; color: #64748b; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="icon">✅</div>
          <h1>¡Asistencia Confirmada!</h1>
          <p>Gracias por confirmar tu asistencia a la cita en <strong>${appt.Business?.name || 'nuestro negocio'}</strong>.</p>
          <p style="margin-top: 1rem; font-size: 0.8rem;">Puedes cerrar esta pestaña ahora.</p>
        </div>
      </body>
      </html>
    `);
  } catch (e) {
    console.error('Error confirming attendance:', e);
    res.status(500).send('<h1>Error al confirmar asistencia</h1>');
  }
}

/**
 * GET /appointments/:id/cancel-from-email
 * Client cancels from email link
 */
async function cancelFromEmail(req, res) {
  try {
    const { id } = req.params;

    const appt = await Appointment.findByPk(id, {
      include: [
        { model: Service },
        { model: Employee, include: [{ model: User, attributes: ['name', 'pushToken'] }] },
        { model: Business, include: [{ model: User, as: 'Owner', attributes: ['id', 'name', 'pushToken', 'email'] }] },
      ],
    });

    if (!appt) return res.status(404).send('<h1>Cita no encontrada</h1>');
    if (appt.status === 'cancelled') return res.status(400).send('<h1>Esta cita ya fue cancelada anteriormente</h1>');

    // Actualizar estado a cancelada
    await appt.update({ status: 'cancelled' });

    // Notificar al dueño
    const owner = appt.Business?.Owner;
    if (owner) {
      // Push
      if (owner.pushToken) {
        await sendCancellationNotification(owner.pushToken, {
          id: appt.id,
          clientName: String(appt.clientName || ''),
          serviceName: String(appt.Service?.name || ''),
          businessName: String(appt.Business?.name || ''),
          startTime: appt.startTime,
        });
      }
      // Email
      if (owner.email) {
        await sendEmail(owner.email, 'appointmentCancelled', {
          businessName: String(appt.Business?.name || ''),
          clientName: String(appt.clientName || ''),
          serviceName: String(appt.Service?.name || ''),
          employeeName: String(appt.Employee?.User?.name || 'No asignado'),
          startTime: appt.startTime,
          cancelTime: new Date()
        });
      }
    }

    // HTML de respuesta
    res.send(`
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Cita Cancelada</title>
        <style>
          body { font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f8fafc; color: #1e293b; }
          .card { background: white; padding: 2rem; border-radius: 1rem; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); text-align: center; max-width: 400px; }
          .icon { font-size: 3rem; margin-bottom: 1rem; }
          h1 { margin: 0 0 0.5rem; font-size: 1.5rem; color: #ef4444; }
          p { margin: 0; color: #64748b; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="icon">❌</div>
          <h1>Cita Cancelada</h1>
          <p>Tu cita en <strong>${appt.Business?.name || 'nuestro negocio'}</strong> ha sido cancelada exitosamente.</p>
          <p style="margin-top: 1rem; font-size: 0.8rem;">Puedes cerrar esta pestaña ahora.</p>
        </div>
      </body>
      </html>
    `);
  } catch (e) {
    console.error('Error cancelling from email:', e);
    res.status(500).send('<h1>Error al procesar la cancelación</h1>');
  }
}

/**
 * PATCH /appointments/:id/employee-status
 * Actualiza el estado individual de un empleado en una cita grupal
 */
async function updateEmployeeStatus(req, res) {
  try {
    const { id: appointmentId } = req.params;
    const { employeeId, status } = req.body;

    if (!employeeId || !status) {
      return res.status(400).json({ error: 'employeeId y status son requeridos' });
    }

    const validStatuses = ['pending', 'on_the_way', 'arrived', 'in_progress', 'done'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Estado inválido. Estados válidos: ' + validStatuses.join(', ') });
    }

    // Buscar el registro AppointmentEmployee
    const appointmentEmployee = await AppointmentEmployee.findOne({
      where: {
        appointmentId,
        employeeId
      }
    });

    if (!appointmentEmployee) {
      return res.status(404).json({ error: 'Empleado no asignado a esta cita' });
    }

    // Actualizar estado
    await appointmentEmployee.update({
      status,
      statusUpdatedAt: new Date()
    });

    // Emitir actualización por socket
    const appointment = await Appointment.findByPk(appointmentId, {
      include: [
        { model: Service },
        { model: Employee, include: [{ model: User, attributes: ['name'] }] },
        { model: AppointmentEmployee, as: 'AdditionalEmployees', include: [{ model: Employee, include: [{ model: User, attributes: ['name'] }] }] }
      ]
    });

    if (appointment) {
      emitAppointmentUpdate(appointment.toJSON());
    }

    res.json({ success: true, status });
  } catch (e) {
    console.error('[updateEmployeeStatus] Error:', e);
    res.status(500).json({ error: e.message });
  }
}

/**
 * GET /appointments/stats
 */
async function getStats(req, res) {
  try {
    const businessId = req.query.businessId || req.params.businessId;
    if (!businessId) return res.status(400).json({ error: 'businessId es requerido' });

    const stats = await queries.getAppointmentStats(businessId);
    res.json(stats);
  } catch (e) {
    console.error('[getStats] Error:', e);
    res.status(500).json({ error: e.message });
  }
}

module.exports = {
  getByBusiness,
  getConsolidated,
  getMyAppointments,
  getMyClientAppointments,
  create,
  updateStatus,
  cancel,
  update,
  extendTime,
  getNotes,
  addNote,
  deleteNote,
  confirmAttendance,
  cancelFromEmail,
  updateEmployeeStatus,
  getStats
};
