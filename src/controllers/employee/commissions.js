/**
 * Comisiones de empleados - Versión Original
 */

const { Employee, User, Appointment, Service, Business } = require('../../models');
const { Op } = require('sequelize');
const { getColombiaDate, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth } = require('./utils');

// Helper: retorna 0 en lugar de NaN para valores corruptos en la BD
const safeFloat = (val) => { const n = parseFloat(val); return isNaN(n) ? 0 : n; };

/**
 * Obtener comisiones del empleado logueado
 */
async function getMyCommissions(req, res) {
  try {
    const userId = req.user.id;
    const { view = 'month', date, page = 1, limit = 8 } = req.query;
    // view: 'day' | 'week' | 'month'
    // date: YYYY-MM-DD para day/week, YYYY-MM para month

    // Buscar el empleado asociado al usuario
    const employee = await Employee.findOne({
      where: { userId, active: true },
      include: [{ model: User, attributes: ['name', 'email'] }]
    });

    if (!employee) {
      return res.status(404).json({ error: 'Empleado no encontrado' });
    }

    // Obtener info del negocio primero
    const business = await Business.findByPk(employee.businessId);
    const isTechnicalServices = business?.isTechnicalServices || false;
    const hasFieldTechnicians = business?.hasFieldTechnicians || false;

    // Determinar rango de fechas según la vista
    const now = getColombiaDate();
    let start, end, periodLabel;

    if (view === 'day') {
      const targetDate = date || now.toISOString().slice(0, 10); // YYYY-MM-DD
      start = startOfDay(targetDate);
      end = endOfDay(targetDate);
      periodLabel = targetDate;
      
      // DEBUG: Verificar fechas generadas
      console.log('=== DEBUG COMMISSIONS (view=day) ===');
      console.log('targetDate:', targetDate);
      console.log('start:', start.toISOString(), '(Colombia:', start.toLocaleString('es-CO', {timeZone: 'America/Bogota'}), ')');
      console.log('end:', end.toISOString(), '(Colombia:', end.toLocaleString('es-CO', {timeZone: 'America/Bogota'}), ')');
      console.log('=====================================');
    } else if (view === 'week') {
      const targetDate = date || now.toISOString().slice(0, 10);
      start = startOfWeek(targetDate);
      end = endOfWeek(targetDate);
      const endStr = end.toISOString().slice(0, 10);
      periodLabel = `${start.toISOString().slice(0, 10)} a ${endStr}`;
    } else {
      // month (default)
      const targetMonth = date || now.toISOString().slice(0, 7); // YYYY-MM
      start = startOfMonth(targetMonth);
      end = endOfMonth(targetMonth);
      periodLabel = targetMonth;
    }

    // Para técnicos de campo, traemos TODAS las citas. Para otros, solo completadas.
    const appointmentWhere = {
      employeeId: employee.id,
      startTime: { [Op.between]: [start, end] }
    };
    
    // Si NO es técnico de campo, filtrar solo citas completadas
    if (!hasFieldTechnicians) {
      appointmentWhere.status = 'done';
    }

    // Buscar citas del empleado en el período
    console.log('appointmentWhere:', JSON.stringify(appointmentWhere, null, 2));
    const allAppointments = await Appointment.findAll({
      where: appointmentWhere,
      include: [
        { model: Service, attributes: ['name', 'price', 'hasEmployeeCommission'] },
        { model: Business, attributes: ['name', 'isTechnicalServices'] }
      ],
      order: [['startTime', 'DESC']]
    });
    
    console.log('Citas encontradas:', allAppointments.length);
    allAppointments.forEach(a => {
      console.log(`- Cita ${a.id.slice(0,8)}: ${a.startTime.toISOString()} (${a.startTime.toLocaleString('es-CO', {timeZone: 'America/Bogota'})}) - ${a.clientName}`);
    });

    const commissionPct = (isTechnicalServices || hasFieldTechnicians) ? 0 : (parseFloat(employee.commissionPct) || 0);

    // Calcular reporte completo para totales
    const allReport = allAppointments.map(appt => {
      // Usar safeFloat para evitar NaN de registros corruptos en la BD
      const hasFinalPrice = appt.finalPrice !== null && appt.finalPrice !== undefined && !isNaN(parseFloat(appt.finalPrice));
      const basePrice = hasFinalPrice ? safeFloat(appt.finalPrice) : safeFloat(appt.Service.price);
      const additional = safeFloat(appt.additionalAmount);
      const totalPrice = hasFinalPrice ? basePrice : (basePrice + additional);
      
      // En servicios técnicos o técnicos de campo no hay comisiones ni precios
      const hideMoney = isTechnicalServices || hasFieldTechnicians;
      const hasCommission = hideMoney ? false : (appt.Service.hasEmployeeCommission !== false);
      
      const supplies = safeFloat(appt.suppliesCost);
      const commissionable = Math.max(0, totalPrice - supplies);
      
      const myCommission = (appt.employeeEarns !== null && appt.employeeEarns !== undefined)
        ? safeFloat(appt.employeeEarns)
        : (hasCommission ? (commissionable * commissionPct / 100) : 0);
      
      return {
        id: appt.id,
        date: appt.startTime,
        service: appt.Service.name,
        client: appt.clientName,
        clientPhone: appt.clientPhone,
        status: appt.status,
        technicianStatus: appt.technicianStatus,
        price: hideMoney ? 0 : totalPrice,
        basePrice: hideMoney ? 0 : basePrice,
        additional: hideMoney ? 0 : additional,
        supplies: hideMoney ? 0 : supplies,
        myCommission: hideMoney ? 0 : parseFloat(myCommission.toFixed(2)),
        commissionPct: hasCommission ? commissionPct : 0,
        hasCommission: hasCommission,
        paymentMethod: appt.paymentMethod,
        isTechnicalService: appt.Service.isTechnicalService || false
      };
    });

    // Totales de todas las citas en el período
    const totals = allReport.reduce((acc, r) => ({
      totalServices:   acc.totalServices + r.price,
      totalCommission: acc.totalCommission + r.myCommission,
      count:           acc.count + 1
    }), { totalServices: 0, totalCommission: 0, count: 0 });

    totals.totalServices = parseFloat(totals.totalServices.toFixed(2));
    totals.totalCommission = parseFloat(totals.totalCommission.toFixed(2));

    // Para técnicos de campo, obtener estadísticas por estado (pending, confirmed, done, cancelled)
    let statusStats = null;
    if (hasFieldTechnicians) {
      const allStatusAppointments = await Appointment.findAll({
        where: {
          employeeId: employee.id,
          startTime: { [Op.between]: [start, end] }
        },
        attributes: ['status']
      });
      
      statusStats = {
        pending: allStatusAppointments.filter(a => a.status === 'pending').length,
        confirmed: allStatusAppointments.filter(a => a.status === 'confirmed').length,
        attention: allStatusAppointments.filter(a => a.status === 'attention').length,
        done: allStatusAppointments.filter(a => a.status === 'done').length,
        cancelled: allStatusAppointments.filter(a => a.status === 'cancelled').length,
        total: allStatusAppointments.length
      };
    }

    // Paginación
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 10;
    const offset = (pageNum - 1) * limitNum;
    const totalPages = Math.ceil(allReport.length / limitNum);
    const paginatedAppointments = allReport.slice(offset, offset + limitNum);

    res.json({
      view,
      period: periodLabel,
      periodStart: start,
      periodEnd: end,
      isTechnicalServices,
      hasFieldTechnicians,
      statusStats,
      employee: {
        id: employee.id,
        name: employee.User?.name,
        commissionPct: commissionPct,
        specialty: employee.specialty
      },
      appointments: paginatedAppointments,
      totals,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: allReport.length,
        totalPages: totalPages,
        hasNext: pageNum < totalPages,
        hasPrev: pageNum > 1
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/**
 * Obtener reporte de comisiones para admin
 */
async function getCommissionReport(req, res) {
  try {
    const businessId = req.query.businessId || req.params.businessId;
    const { month, startDate, endDate } = req.query;
    
    if (!businessId)
      return res.status(400).json({ error: 'businessId es requerido' });

    let start, end;
    if (startDate && endDate) {
      start = startOfDay(startDate);
      end = endOfDay(endDate);
    } else if (month) {
      start = startOfMonth(month);
      end = endOfMonth(month);
    } else {
      return res.status(400).json({ error: 'month (YYYY-MM) o startDate/endDate (YYYY-MM-DD) son requeridos' });
    }

    const appointments = await Appointment.findAll({
      where: {
        businessId,
        status: 'done', // Solo citas completadas generan ingresos
        startTime: { [Op.between]: [start, end] }
      },
      include: [
        { model: Service },
        { 
          model: Employee, 
          include: [{ model: User, attributes: ['name'] }] 
        }
      ]
    });

    const report = appointments.map(appt => {
      // Usar safeFloat para evitar NaN de registros corruptos en la BD
      const hasFinalPrice = appt.finalPrice !== null && appt.finalPrice !== undefined && !isNaN(parseFloat(appt.finalPrice));
      const totalPrice = hasFinalPrice ? safeFloat(appt.finalPrice) : (safeFloat(appt.Service?.price) + safeFloat(appt.additionalAmount));
      
      const hasCommission = appt.Service?.hasEmployeeCommission !== false;
      const commissionPct = hasCommission ? safeFloat(appt.Employee?.commissionPct) : 0;
      
      const supplies = safeFloat(appt.suppliesCost);
      const commissionable = Math.max(0, totalPrice - supplies);
      
      const employeeEarns = (appt.employeeEarns !== null && appt.employeeEarns !== undefined)
        ? safeFloat(appt.employeeEarns)
        : (commissionable * commissionPct / 100);
        
      const ownerEarns = totalPrice - employeeEarns;
      
      return {
        date:          appt.startTime,
        service:       appt.Service?.name || 'Servicio eliminado',
        extraServices: Array.isArray(appt.extraServices) ? appt.extraServices : [],
        client:        appt.clientName,
        price:         totalPrice,
        basePrice:     hasFinalPrice ? parseFloat(appt.finalPrice) : parseFloat(appt.Service?.price || 0),
        additional:    parseFloat(appt.additionalAmount || 0),
        supplies:      supplies,
        employee:      appt.Employee?.User?.name || 'Empleado eliminado',
        employeeEarns: employeeEarns.toFixed(2),
        ownerEarns:    ownerEarns.toFixed(2),
        hasCommission: hasCommission,
        paymentMethod: appt.paymentMethod || 'cash',
      };
    });

    const totals = report.reduce((acc, r) => ({
      total:         acc.total + parseFloat(r.price),
      employeeTotal: acc.employeeTotal + parseFloat(r.employeeEarns),
      ownerTotal:    acc.ownerTotal + parseFloat(r.ownerEarns),
    }), { total: 0, employeeTotal: 0, ownerTotal: 0 });

    // Redondear totales a 2 decimales
    totals.total = parseFloat(totals.total.toFixed(2));
    totals.employeeTotal = parseFloat(totals.employeeTotal.toFixed(2));
    totals.ownerTotal = parseFloat(totals.ownerTotal.toFixed(2));

    res.json({ appointments: report, totals });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

module.exports = {
  getMyCommissions,
  getCommissionReport
};
