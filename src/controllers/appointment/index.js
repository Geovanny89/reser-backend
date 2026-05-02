/**
 * Módulo de Citas - Punto de entrada
 * 
 * Este módulo organiza la lógica de citas en archivos separados:
 * - utils.js: Funciones de utilidad (fechas, formatos)
 * - constants.js: Constantes y configuraciones
 * - queries.js: Consultas a base de datos
 * - actions.js: Acciones principales (CRUD)
 * - handlers.js: Handlers HTTP para Express
 * 
 * La API se mantiene exactamente igual para compatibilidad.
 */

const utils = require('./utils');
const constants = require('./constants');
const queries = require('./queries');
const actions = require('./actions');
const handlers = require('./handlers');
const clients = require('./clients');
const public = require('./public');
const availability = require('./availability');
const technical = require('./technical');
const birthday = require('./birthday');

// Re-exportar todo para compatibilidad
module.exports = {
  // Handlers HTTP básicos (los que usa Express)
  getByBusiness: handlers.getByBusiness,
  getConsolidated: handlers.getConsolidated,
  getMyAppointments: handlers.getMyAppointments,
  getMyClientAppointments: handlers.getMyClientAppointments,
  create: handlers.create,
  updateStatus: handlers.updateStatus,
  cancel: handlers.cancel,
  update: handlers.update,
  extendTime: handlers.extendTime,
  getNotes: handlers.getNotes,
  addNote: handlers.addNote,
  deleteNote: handlers.deleteNote,
  updateEmployeeStatus: handlers.updateEmployeeStatus,
  
  // Handlers de clientes y etiquetas
  getClientsByBusiness: async (req, res) => {
    try {
      const businessId = req.query.businessId || req.params.businessId;
      if (!businessId) return res.status(400).json({ error: 'businessId es requerido' });
      const result = await clients.getClientsByBusiness(businessId, req.query.search);
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  },
  updateClient: async (req, res) => {
    try {
      const result = await clients.updateClient(req.body);
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  },
  getClientTags: async (req, res) => {
    try {
      const businessId = req.query.businessId || req.params.businessId;
      if (!businessId) return res.status(400).json({ error: 'businessId es requerido' });
      const result = await clients.getClientTags(businessId);
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  },
  createClientTag: async (req, res) => {
    try {
      const result = await clients.createClientTag(req.body);
      res.json({ success: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  },
  updateClientTag: async (req, res) => {
    try {
      const result = await clients.updateClientTag(req.params.id, req.body);
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  },
  deleteClientTag: async (req, res) => {
    try {
      const result = await clients.deleteClientTag(req.params.id);
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  },
  assignTagToClient: async (req, res) => {
    try {
      const result = await clients.assignTagToClient(req.body);
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  },
  removeTagFromClient: async (req, res) => {
    try {
      const result = await clients.removeTagFromClient(req.params.assignmentId);
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  },
  updateClient: async (req, res) => {
    try {
      const { businessId } = req.query;
      const { originalPhone, originalEmail, newName, newPhone, newEmail, birthday } = req.body;
      const result = await clients.updateClientData(businessId, originalPhone, originalEmail, newName, newPhone, newEmail, birthday);
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  },
  
  // Handlers de cumpleaños
  getBirthdayTemplates: async (req, res) => {
    try {
      const { businessId } = req.query;
      const result = await birthday.getTemplates(businessId);
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  },
  saveBirthdayTemplate: async (req, res) => {
    try {
      const result = await birthday.saveTemplate(req.body);
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  },
  deleteBirthdayTemplate: async (req, res) => {
    try {
      const result = await birthday.deleteTemplate(req.params.id);
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  },
  
  // Handlers de disponibilidad
  getAvailability: async (req, res) => {
    try {
      const { date, employeeId, serviceId, businessId, allowPast } = req.query;
      const result = await availability.getAvailability(date, employeeId, serviceId, businessId, allowPast === 'true');
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  },
  
  validateManualTime: async (req, res) => {
    try {
      const { date, employeeId, serviceId, businessId, manualTime } = req.query;
      const result = await availability.validateManualTime(date, employeeId, serviceId, businessId, manualTime);
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  },
  
  // Handlers públicos (sin auth) - usan handlers.js que retorna HTML
  confirmAttendance: handlers.confirmAttendance,
  cancelFromEmail: handlers.cancelFromEmail,
  verifyForRating: async (req, res) => {
    try {
      const result = await public.verifyForRating(req.params.id);
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  },
  rateAppointment: async (req, res) => {
    try {
      const { rating, comment } = req.body;
      const result = await public.rateAppointment(req.params.id, rating, comment);
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  },
  
  // Handlers técnicos
  updateTechnicianStatus: async (req, res) => {
    try {
      const result = await technical.updateTechnicianStatus(req.params.id, req.body.status, req.user.id);
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  },
  saveTechnicalReport: async (req, res) => {
    try {
      const result = await technical.saveTechnicalReport(req.params.id, req.body, req.user.id);
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  },
  getTechnicalReport: async (req, res) => {
    try {
      const result = await technical.getTechnicalReport(req.params.id, req.user.id);
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  },
  saveClientSignature: async (req, res) => {
    try {
      const { signature, clientName } = req.body;
      const result = await technical.saveClientSignature(req.params.id, { signature, clientName }, req.user.id);
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  },
  getClientSignature: async (req, res) => {
    try {
      const result = await technical.getClientSignature(req.params.id, req.user.id);
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  },
  transferAppointment: async (req, res) => {
    try {
      const { newEmployeeId, newStartTime } = req.body;
      const result = await technical.transferAppointment(req.params.id, newEmployeeId, newStartTime, req.user);
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  },
  addAdditionalCharge: async (req, res) => {
    try {
      const { additionalAmount, additionalNote } = req.body;
      const result = await technical.addAdditionalCharge(req.params.id, additionalAmount, additionalNote);
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  },
  saveWorkEvidences: async (req, res) => {
    try {
      const { photos, replaceAll } = req.body;
      const result = await technical.saveWorkEvidences(req.params.id, { photos, replaceAll }, req.user.id);
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  },
  getWorkEvidences: async (req, res) => {
    try {
      const result = await technical.getWorkEvidences(req.params.id, req.user.id);
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  },
  deleteWorkEvidence: async (req, res) => {
    try {
      const { photoIndex } = req.body;
      const result = await technical.deleteWorkEvidence(req.params.id, photoIndex, req.user.id);
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  },
  
  // Email handlers
  sendReceipt: async (req, res) => {
    try {
      const { sendPaymentReceipt } = require('./actions');
      const appt = await queries.getAppointmentById(req.params.id);
      if (!appt) return res.status(404).json({ error: 'Cita no encontrada' });
      if (appt.status !== 'done') return res.status(400).json({ error: 'Solo se puede enviar comprobante de citas completadas' });

      await sendPaymentReceipt(appt);
      res.json({ message: 'Comprobante de pago enviado exitosamente' });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  },

  /**
   * Descargar/Visualizar Orden de Servicio en PDF
   */
  downloadServiceOrder: async (req, res) => {
    try {
      const { generatePaymentReceipt } = require('../../utils/pdfGenerator');
      const appt = await queries.getAppointmentById(req.params.id);
      if (!appt) return res.status(404).json({ error: 'Cita no encontrada' });

      console.log('[PDF Debug] appointment data:', {
        id: appt.id,
        workReport: appt.workReport,
        workEvidences: appt.workEvidences,
        clientSignature: appt.clientSignature ? 'EXISTS' : 'MISSING',
        clientSignatureName: appt.clientSignatureName,
        clientSignatureDate: appt.clientSignatureDate
      });

      // Siempre generar como Orden de Servicio técnica completa
      const isTechnicalService = true;
      const orderNumber = appt.id.substring(0, 8).toUpperCase();

      const basePrice = parseFloat(appt.basePrice || appt.Service?.price || 0);
      const additionalCharges = appt.additionalCharges || [];
      const additional = additionalCharges.reduce((sum, charge) => sum + parseFloat(charge.amount || 0), 0);

      // Generar PDF
      const pdfBuffer = await generatePaymentReceipt({
        businessId: appt.businessId,
        businessName: appt.Business?.name,
        businessLogoUrl: appt.Business?.logoUrl,
        businessAddress: appt.Business?.address,
        businessPhone: appt.Business?.phone,
        businessNit: appt.Business?.nit,
        id: appt.id,
        clientName: appt.clientName,
        clientEmail: appt.clientEmail,
        clientPhone: appt.clientPhone,
        serviceName: appt.Service?.name,
        serviceDescription: appt.Service?.description,
        employeeName: appt.Employee?.User?.name,
        startTime: appt.startTime,
        endTime: appt.endTime,
        price: basePrice,
        additionalAmount: additional,
        additionalNote: appt.additionalNote,
        paymentMethod: appt.paymentMethod || 'Efectivo',
        notes: appt.notes,
        isTechnicalService: true,
        clientSignature: appt.clientSignature,
        clientSignatureName: appt.clientSignatureName,
        clientSignatureDate: appt.clientSignatureDate,
        workEvidences: appt.workEvidences,
        workReport: appt.workReport,
      });

      // Configurar headers para el PDF
      const filename = `orden-servicio-${orderNumber}.pdf`;
      const shouldDownload = req.query.download === 'true';

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Length', pdfBuffer.length);
      
      if (shouldDownload) {
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      } else {
        res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
      }

      res.send(pdfBuffer);
    } catch (e) {
      console.error('[Download Service Order] Error:', e);
      res.status(500).json({ error: e.message });
    }
  },

  // Utilidades (por si se necesitan externamente)
  utils,
  constants,
  queries,
  actions,
  clients,
  public,
  availability,
  technical,
  
  // Funciones individuales para uso avanzado
  ...utils,
  ...queries,
  ...actions
};
