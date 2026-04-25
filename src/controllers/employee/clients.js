/**
 * Clientes frecuentes del empleado - Versión Original
 */

const { Employee, Appointment, Service, User } = require('../../models');
const { Op } = require('sequelize');

/**
 * Obtener clientes frecuentes del empleado logueado
 */
async function getMyFrequentClients(req, res) {
  try {
    const userId = req.user.id;

    const employee = await Employee.findOne({
      where: { userId, active: true },
      include: [{ model: User, attributes: ['name', 'email'] }]
    });

    if (!employee) {
      return res.status(404).json({ error: 'Empleado no encontrado' });
    }

    // Buscar todas las citas completadas
    const appointments = await Appointment.findAll({
      where: {
        employeeId: employee.id,
        status: 'done'
      },
      include: [
        { model: Service, attributes: ['name', 'price'] }
      ],
      order: [['startTime', 'DESC']]
    });

    // Agrupar por cliente
    const clientMap = new Map();
    
    appointments.forEach(apt => {
      const key = apt.clientPhone || apt.clientEmail || apt.clientName;
      if (!key) return;
      
      if (!clientMap.has(key)) {
        clientMap.set(key, {
          name: apt.clientName,
          phone: apt.clientPhone,
          email: apt.clientEmail,
          visits: 0,
          totalSpent: 0,
          lastVisit: null,
          services: new Set()
        });
      }
      
      const client = clientMap.get(key);
      client.visits++;
      const price = parseFloat(apt.Service?.price) || 0;
      const additional = parseFloat(apt.additionalAmount) || 0;
      client.totalSpent += price + additional;
      client.services.add(apt.Service.name);
      
      if (!client.lastVisit || new Date(apt.startTime) > new Date(client.lastVisit)) {
        client.lastVisit = apt.startTime;
      }
    });

    // Convertir a array y ordenar por visitas
    const clients = Array.from(clientMap.values())
      .map(c => ({
        ...c,
        services: Array.from(c.services),
        totalSpent: parseFloat(c.totalSpent.toFixed(2))
      }))
      .sort((a, b) => b.visits - a.visits);

    res.json({
      totalClients: clients.length,
      clients: clients.slice(0, 50) // Limitar a 50 clientes más frecuentes
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

module.exports = {
  getMyFrequentClients
};
