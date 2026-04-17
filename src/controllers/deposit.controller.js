const { Deposit, Business, Appointment, Service } = require('../models');
const { Op } = require('sequelize');

exports.getByBusiness = async (req, res) => {
  try {
    const { businessId } = req.query;
    if (!businessId) return res.status(400).json({ error: 'businessId es requerido' });

    const { status, startDate, endDate } = req.query;
    const where = { businessId };

    if (status) where.status = status;
    if (startDate && endDate) {
      where.date = { [Op.between]: [startDate, endDate] };
    }

    const deposits = await Deposit.findAll({
      where,
      include: [
        { 
          model: Appointment, 
          attributes: ['id', 'clientName', 'startTime'],
          include: [{ model: Service, attributes: ['id', 'name', 'price'] }]
        }
      ],
      order: [['date', 'DESC'], ['createdAt', 'DESC']]
    });

    // Totales por estado
    const summary = {
      held: 0,
      applied: 0,
      refunded: 0,
      forfeited: 0
    };
    
    deposits.forEach(d => {
      summary[d.status] += parseFloat(d.amount || 0);
    });

    res.json({ deposits, summary });
  } catch (e) {
    console.error('[getByBusiness] Error:', e);
    res.status(500).json({ error: e.message });
  }
};

exports.create = async (req, res) => {
  try {
    const { businessId, appointmentId, clientName, clientPhone, amount, date, paymentMethod, notes } = req.body;

    if (!businessId || !clientName || !amount || !date) {
      return res.status(400).json({ error: 'businessId, clientName, amount y date son requeridos' });
    }

    // Verificar módulo habilitado
    const business = await Business.findByPk(businessId);
    if (!business) return res.status(404).json({ error: 'Negocio no encontrado' });
    
    const enabledModules = business.enabledModules || {};
    if (!enabledModules.deposits) {
      return res.status(403).json({ error: 'El módulo de depósitos no está habilitado' });
    }

    const deposit = await Deposit.create({
      businessId,
      appointmentId: appointmentId || null,
      clientName,
      clientPhone,
      amount: parseFloat(amount),
      date,
      paymentMethod: paymentMethod || 'cash',
      status: 'held',
      notes,
      createdBy: req.user?.id
    });

    res.status(201).json(deposit);
  } catch (e) {
    console.error('[create] Error:', e);
    res.status(500).json({ error: e.message });
  }
};

exports.updateStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['held', 'applied', 'refunded', 'forfeited'].includes(status)) {
      return res.status(400).json({ error: 'Estado inválido' });
    }

    const deposit = await Deposit.findByPk(id);
    if (!deposit) return res.status(404).json({ error: 'Depósito no encontrado' });

    await deposit.update({ status });
    res.json(deposit);
  } catch (e) {
    console.error('[updateStatus] Error:', e);
    res.status(500).json({ error: e.message });
  }
};

exports.applyToAppointment = async (req, res) => {
  try {
    const { id } = req.params;
    const { appointmentId } = req.body;

    const deposit = await Deposit.findByPk(id);
    if (!deposit) return res.status(404).json({ error: 'Depósito no encontrado' });

    if (deposit.status !== 'held') {
      return res.status(400).json({ error: 'Solo depósitos retenidos pueden aplicarse' });
    }

    const appointment = await Appointment.findByPk(appointmentId);
    if (!appointment) return res.status(404).json({ error: 'Cita no encontrada' });

    await deposit.update({ 
      status: 'applied',
      appointmentId 
    });

    res.json({ message: 'Depósito aplicado a la cita', deposit });
  } catch (e) {
    console.error('[applyToAppointment] Error:', e);
    res.status(500).json({ error: e.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const { id } = req.params;
    const deposit = await Deposit.findByPk(id);
    if (!deposit) return res.status(404).json({ error: 'Depósito no encontrado' });

    await deposit.destroy();
    res.json({ message: 'Depósito eliminado' });
  } catch (e) {
    console.error('[remove] Error:', e);
    res.status(500).json({ error: e.message });
  }
};

exports.getByClient = async (req, res) => {
  try {
    const { clientPhone, businessId } = req.query;
    if (!clientPhone || !businessId) {
      return res.status(400).json({ error: 'clientPhone y businessId son requeridos' });
    }

    const deposits = await Deposit.findAll({
      where: { 
        businessId, 
        clientPhone,
        status: { [Op.in]: ['held', 'applied'] }
      },
      order: [['date', 'DESC']]
    });

    const total = deposits.reduce((sum, d) => sum + parseFloat(d.amount || 0), 0);

    res.json({ deposits, total: parseFloat(total.toFixed(2)) });
  } catch (e) {
    console.error('[getByClient] Error:', e);
    res.status(500).json({ error: e.message });
  }
};
