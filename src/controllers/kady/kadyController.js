const kadyService = require('../../services/kady/kadyService');

/**
 * Controlador para las peticiones del chatbot Kady
 */
class KadyController {
  /**
   * Obtiene la info del negocio para inicializar Kady
   */
  async getInitialData(req, res) {
    try {
      const { slug } = req.params;
      const business = await kadyService.getBusinessInfo(slug);

      if (!business) {
        return res.status(404).json({ error: 'Negocio no encontrado o inactivo' });
      }

      res.json(business);
    } catch (error) {
      res.status(500).json({ error: 'Error al cargar Kady: ' + error.message });
    }
  }

  /**
   * Busca citas por nombre del cliente
   */
  async getAppointments(req, res) {
    try {
      const { slug, fullName } = req.query;

      if (!slug || !fullName) {
        return res.status(400).json({ error: 'Faltan parámetros: slug y fullName son requeridos' });
      }

      const appointments = await kadyService.searchAppointments(slug, fullName);
      res.json(appointments);
    } catch (error) {
      res.status(500).json({ error: 'Error al buscar citas: ' + error.message });
    }
  }

  /**
   * Registra una nueva cita pendiente
   */
  async bookAppointment(req, res) {
    try {
      const { slug } = req.params;
      const appointmentData = req.body;

      if (!slug) {
        return res.status(400).json({ error: 'Slug del negocio es requerido' });
      }

      const appointment = await kadyService.createPendingAppointment(slug, appointmentData);
      res.status(201).json({
        message: 'Cita registrada con éxito. Pendiente de confirmación vía WhatsApp.',
        appointment
      });
    } catch (error) {
      res.status(500).json({ error: 'Error al agendar cita: ' + error.message });
    }
  }

  /**
   * Obtiene la lista de empleados del negocio
   */
  async getEmployees(req, res) {
    try {
      const { slug } = req.params;
      const employees = await kadyService.getBusinessEmployees(slug);
      res.json(employees);
    } catch (error) {
      res.status(500).json({ error: 'Error al obtener empleados: ' + error.message });
    }
  }

  /**
   * Obtiene horarios disponibles
   */
  async getSlots(req, res) {
    try {
      const { slug, employeeId, date, serviceId } = req.query;

      if (!slug || !employeeId || !date || !serviceId) {
        return res.status(400).json({ error: 'Faltan parámetros: slug, employeeId, date y serviceId son requeridos' });
      }

      const slots = await kadyService.getAvailableSlots(slug, employeeId, date, serviceId);
      res.json(slots);
    } catch (error) {
      res.status(500).json({ error: 'Error al obtener horarios: ' + error.message });
    }
  }
}

module.exports = new KadyController();
