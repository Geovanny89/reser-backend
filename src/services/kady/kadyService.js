const { Business, Service, Appointment, Employee, User, Op } = require('../../models');
const { getAvailability } = require('../../controllers/appointment/availability');
const actions = require('../../controllers/appointment/actions');

/**
 * Servicio modular para el chatbot Kady
 */
class KadyService {
  /**
   * Obtiene la información pública de un negocio por su slug
   */
  async getBusinessInfo(slug) {
    try {
      const business = await Business.findOne({
        where: { slug, status: 'active' },
        attributes: [
          'id', 'name', 'slug', 'logoUrl', 'primaryColor', 'secondaryColor', 
          'tagline', 'phone', 'address', 'instagram', 'facebook', 'whatsapp'
        ],
        include: [
          {
            model: Service,
            as: 'Services',
            where: { active: true },
            attributes: ['id', 'name', 'description', 'price', 'durationMin', 'imageUrl'],
            required: false
          }
        ]
      });

      return business;
    } catch (error) {
      console.error('[Kady Service] Error al obtener negocio:', error.message);
      throw error;
    }
  }

  /**
   * Busca citas activas por el nombre completo del cliente y el slug del negocio
   */
  async searchAppointments(slug, fullName) {
    try {
      const business = await Business.findOne({ where: { slug }, attributes: ['id'] });
      if (!business) throw new Error('Negocio no encontrado');

      // Buscamos citas que coincidan con el nombre del cliente (case insensitive)
      const appointments = await Appointment.findAll({
        where: {
          businessId: business.id,
          clientName: { [Op.iLike]: `%${fullName}%` },
          status: { [Op.notIn]: ['cancelled'] }
        },
        include: [
          { model: Service, attributes: ['name'] }
        ],
        order: [['startTime', 'ASC']],
        limit: 5 // Limitamos para no saturar el chat
      });

      return appointments;
    } catch (error) {
      console.error('[Kady Service] Error al buscar citas:', error.message);
      throw error;
    }
  }

  /**
   * Registra una cita pendiente desde el chatbot
   */
  async createPendingAppointment(slug, appointmentData) {
    try {
      const business = await Business.findOne({ where: { slug }, attributes: ['id'] });
      if (!business) throw new Error('Negocio no encontrado');

      const { date, startTime } = appointmentData;
      
      // Combinar fecha y hora en formato ISO para que actions.createAppointment lo procese (con zona horaria Colombia)
      const startTimeISO = `${date}T${startTime}:00-05:00`;

      // Usar el action centralizado para disparar todas las notificaciones (Sockets, Push, Email, WhatsApp)
      const newAppointment = await actions.createAppointment({
        ...appointmentData,
        businessId: business.id,
        startTime: startTimeISO,
        source: 'kady_chatbot',
        status: 'pending'
      }, null); // No hay usuario autenticado (es el chatbot)

      return newAppointment;
    } catch (error) {
      console.error('[Kady Service] Error al crear cita pendiente:', error.message);
      throw error;
    }
  }

  /**
   * Obtiene la lista de profesionales (empleados) de un negocio
   */
  async getBusinessEmployees(slug) {
    try {
      const business = await Business.findOne({ where: { slug }, attributes: ['id'] });
      if (!business) throw new Error('Negocio no encontrado');

      const employees = await Employee.findAll({
        where: { businessId: business.id, active: true },
        attributes: ['id', 'specialty', 'photoUrl'],
        include: [
          {
            model: User,
            attributes: ['name']
          }
        ]
      });

      // Mapeamos para que el frontend reciba un objeto plano con "name"
      return employees.map(e => ({
        id: e.id,
        name: e.User?.name || 'Profesional',
        specialty: e.specialty,
        imageUrl: e.photoUrl
      }));
    } catch (error) {
      console.error('[Kady Service] Error al obtener empleados:', error.message);
      throw error;
    }
  }

  /**
   * Obtiene horarios disponibles para un profesional en una fecha y servicio específicos
   */
  async getAvailableSlots(slug, employeeId, date, serviceId) {
    try {
      const business = await Business.findOne({ where: { slug }, attributes: ['id'] });
      if (!business) throw new Error('Negocio no encontrado');

      // Reutilizamos la lógica robusta de disponibilidad del sistema
      const availability = await getAvailability(date, employeeId, serviceId, business.id);
      return availability.availableSlots || [];
    } catch (error) {
      console.error('[Kady Service] Error al obtener disponibilidad:', error.message);
      throw error;
    }
  }
}

module.exports = new KadyService();
