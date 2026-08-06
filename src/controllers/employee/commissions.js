/**
 * Comisiones de empleados - Versión Original
 */

const { Employee, User, Appointment, Service, Business, AppointmentEmployee } = require('../../models');
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

    // Buscamos citas DONDE el empleado es PRINCIPAL O ADICIONAL
    // 1. Como empleado principal
    // Para técnicos de campo, traemos TODAS las citas. Para otros, solo completadas.
    const mainAppointmentsPromise = Appointment.findAll({
      where: {
        employeeId: employee.id,
        startTime: { [Op.between]: [start, end] },
        ...(!hasFieldTechnicians ? { status: 'done' } : {}),
      },
      include: [
        { model: Service, attributes: ['name', 'price', 'hasEmployeeCommission'] },
        { model: Business, attributes: ['name', 'isTechnicalServices'] },
        {
          model: AppointmentEmployee,
          as: 'AdditionalEmployees',
          include: [
            { model: Employee, include: [{ model: User, attributes: ['name'] }] }
          ]
        }
      ],
      order: [['startTime', 'DESC']]
    });

    // 2. Como empleado adicional (tabla AppointmentEmployee)
    const extraAppointmentsPromise = AppointmentEmployee.findAll({
      where: { employeeId: employee.id },
      include: [{
        model: Appointment,
        required: true,
        where: {
          startTime: { [Op.between]: [start, end] },
          ...(!hasFieldTechnicians ? { status: 'done' } : {}),
        },
        include: [
          { model: Service, attributes: ['name', 'price', 'hasEmployeeCommission'] },
          { model: Business, attributes: ['name', 'isTechnicalServices'] },
          {
            model: Employee,
            include: [{ model: User, attributes: ['name'] }]
          },
          {
            model: AppointmentEmployee,
            as: 'AdditionalEmployees',
            include: [
              { model: Employee, include: [{ model: User, attributes: ['name'] }] }
            ]
          }
        ],
      }],
      order: [[Appointment, 'startTime', 'DESC']]
    });

    const [mainAppointments, extraAppointmentsRaw] = await Promise.all([
      mainAppointmentsPromise,
      extraAppointmentsPromise
    ]);

    // Unir ambas listas evitando duplicados (mismo appointmentId)
    const seen = new Set();
    const allAppointments = [];
    mainAppointments.forEach(a => {
      if (!seen.has(a.id)) {
        seen.add(a.id);
        allAppointments.push(a);
      }
    });
    extraAppointmentsRaw.forEach(ae => {
      if (ae.Appointment && !seen.has(ae.Appointment.id)) {
        seen.add(ae.Appointment.id);
        allAppointments.push(ae.Appointment);
      }
    });

    // Ordenar por startTime DESC
    allAppointments.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
    
    console.log('Citas encontradas (principal + adicional):', allAppointments.length);
    allAppointments.forEach(a => {
      console.log(`- Cita ${a.id.slice(0,8)}: ${a.startTime.toISOString()} (${a.startTime.toLocaleString('es-CO', {timeZone: 'America/Bogota'})}) - ${a.clientName}`);
    });

    const commissionPct = (isTechnicalServices || hasFieldTechnicians) ? 0 : (parseFloat(employee.commissionPct) || 0);

    /**
     * Helper: Calcula ingresos de ESTE empleado en la cita (no todo el total).
     * - Si es el principal: (total_cita - suma_extras)
     * - Si es adicional: la suma de extraServices.price cuyo employeeId === employee.id
     * - Descuento solo se reparte si NO hay finalPrice (porque finalPrice ya lo incluye)
     */
    const calcEmployeeShare = (appt, empId) => {
      const finalPriceVal = safeFloat(appt.finalPrice);
      const basePrice = safeFloat(appt.Service?.price) || safeFloat(appt.basePrice);
      const additional = safeFloat(appt.additionalAmount);
      const extras = Array.isArray(appt.extraServices) ? appt.extraServices : [];
      const discountApplied = safeFloat(appt.discountApplied);
      const hasFinal = finalPriceVal > 0;

      // 1. Suma de extras primero
      let sumExtraPrices = 0;
      let myExtras = 0;
      extras.forEach(es => {
        const price = safeFloat(es.price);
        sumExtraPrices += price;
        if (String(es.employeeId) === String(empId)) {
          myExtras += price;
        }
      });

      // 2. Valor del principal
      const principalGross = hasFinal
        ? Math.max(0, finalPriceVal - sumExtraPrices)
        : Math.max(0, basePrice + additional - sumExtraPrices);

      const totalPrincipalGross = principalGross;
      let myGross = 0;
      let totalGross = 0;

      totalGross += totalPrincipalGross;
      if (String(appt.employeeId) === String(empId)) {
        myGross += principalGross;
      }
      // Mis extras ya calculados
      myGross += myExtras;
      totalGross += sumExtraPrices;

      // Reparto de descuento SOLO si no hay finalPrice
      let myDiscount = 0;
      if (!hasFinal && discountApplied > 0 && totalGross > 0) {
        myDiscount = (myGross / totalGross) * discountApplied;
      }

      return Math.max(0, myGross - myDiscount);
    };

    // Calcular reporte completo para totales
    const allReport = allAppointments.map(appt => {
      // En servicios técnicos o técnicos de campo no hay comisiones ni precios
      const hideMoney = isTechnicalServices || hasFieldTechnicians;

      // Servicio principal y adicionales juntos para mostrar al empleado lo que él hizo
      const extrasDoneByMe = (Array.isArray(appt.extraServices) ? appt.extraServices : [])
        .filter(es => String(es.employeeId) === String(employee.id));

      const serviceList = [];
      if (String(appt.employeeId) === String(employee.id)) {
        serviceList.push(appt.Service?.name || 'Servicio eliminado');
      }
      extrasDoneByMe.forEach(es => serviceList.push(es.name));
      const serviceLabel = serviceList.length > 0 ? serviceList.join(' + ') : (appt.Service?.name || 'Servicio eliminado');

      // Ingresos TOTALES de la cita (para referencia)
      const hasFinalPrice = appt.finalPrice !== null && appt.finalPrice !== undefined && !isNaN(parseFloat(appt.finalPrice));
      const totalBase = hasFinalPrice ? safeFloat(appt.finalPrice) : safeFloat(appt.Service?.price);
      const totalAdditional = hasFinalPrice ? 0 : safeFloat(appt.additionalAmount);
      const totalPrice = hasFinalPrice ? totalBase : (totalBase + totalAdditional);

      // Ingresos QUE CORRESPONDEN A ESTE EMPLEADO
      const myShare = calcEmployeeShare(appt, employee.id);

      const hasCommission = hideMoney ? false : (appt.Service?.hasEmployeeCommission !== false);
      
      const supplies = safeFloat(appt.suppliesCost);
      // Descontar insumos proporcionalmente a mi share vs total
      const suppliesShare = totalPrice > 0 ? (myShare / totalPrice) * supplies : 0;
      const commissionable = Math.max(0, myShare - suppliesShare);
      
      const myCommission = (appt.employeeEarns !== null && appt.employeeEarns !== undefined && String(appt.employeeId) === String(employee.id))
        ? safeFloat(appt.employeeEarns)
        : (hasCommission ? (commissionable * commissionPct / 100) : 0);
      
      return {
        id: appt.id,
        date: appt.startTime,
        service: serviceLabel,
        client: appt.clientName,
        clientPhone: appt.clientPhone,
        status: appt.status,
        technicianStatus: appt.technicianStatus,
        price: hideMoney ? 0 : totalPrice,
        myShare: hideMoney ? 0 : parseFloat(myShare.toFixed(2)),
        basePrice: hideMoney ? 0 : totalBase,
        additional: hideMoney ? 0 : totalAdditional,
        supplies: hideMoney ? 0 : supplies,
        myCommission: hideMoney ? 0 : parseFloat(myCommission.toFixed(2)),
        commissionPct: hasCommission ? commissionPct : 0,
        hasCommission: hasCommission,
        paymentMethod: appt.paymentMethod,
        isTechnicalService: appt.Service?.isTechnicalService || false,
        // Info para UI: que servicios hizo este empleado
        isPrincipal: String(appt.employeeId) === String(employee.id),
        extrasDoneByMe: extrasDoneByMe.map(e => ({ name: e.name, price: e.price })),
      };
    });

    // Totales de todas las citas en el período
    const totals = allReport.reduce((acc, r) => ({
      totalServices:   acc.totalServices + r.myShare,
      totalCommission: acc.totalCommission + r.myCommission,
      count:           acc.count + 1
    }), { totalServices: 0, totalCommission: 0, count: 0 });

    totals.totalServices = parseFloat(totals.totalServices.toFixed(2));
    totals.totalCommission = parseFloat(totals.totalCommission.toFixed(2));

    // Para técnicos de campo, obtener estadísticas por estado (pending, confirmed, done, cancelled)
    // incluyendo citas donde sea principal o adicional
    let statusStats = null;
    if (hasFieldTechnicians) {
      const [mainStatus, extraStatus] = await Promise.all([
        Appointment.findAll({
          where: {
            employeeId: employee.id,
            startTime: { [Op.between]: [start, end] }
          },
          attributes: ['status']
        }),
        AppointmentEmployee.findAll({
          where: { employeeId: employee.id },
          include: [{
            model: Appointment,
            required: true,
            attributes: ['status'],
            where: { startTime: { [Op.between]: [start, end] } }
          }]
        })
      ]);
      const allStatuses = [
        ...mainStatus.map(a => a.status),
        ...extraStatus.map(ae => ae.Appointment?.status).filter(Boolean)
      ];
      const seenIds = new Set([
        ...mainStatus.map(a => a.id),
        ...extraStatus.map(ae => ae.Appointment?.id).filter(Boolean)
      ]);
      statusStats = {
        pending: allStatuses.filter(s => s === 'pending').length,
        confirmed: allStatuses.filter(s => s === 'confirmed').length,
        attention: allStatuses.filter(s => s === 'attention').length,
        done: allStatuses.filter(s => s === 'done').length,
        cancelled: allStatuses.filter(s => s === 'cancelled').length,
        total: seenIds.size
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
      attributes: [
        'id', 'businessId', 'clientName', 'clientPhone', 'startTime',
        'employeeId', 'serviceId', 'status',
        'basePrice', 'additionalAmount', 'discountApplied',
        'finalPrice', 'extraServices', 'suppliesCost',
        'paymentMethod'
      ],
      include: [
        { model: Service, attributes: ['id', 'name', 'price', 'hasEmployeeCommission'] },
        {
          model: Employee,
          attributes: ['id', 'commissionPct'],
          include: [{ model: User, attributes: ['name'] }]
        },
        {
          model: AppointmentEmployee,
          as: 'AdditionalEmployees',
          attributes: ['id', 'employeeId'],
          include: [
            {
              model: Employee,
              attributes: ['id', 'commissionPct'],
              include: [{ model: User, attributes: ['name'] }]
            }
          ]
        }
      ]
    });

    // Mapa de empleados (principal + adicionales + extras por employeeId en JSON)
    // para resolver commissionPct/nombre aunque falte el join AppointmentEmployees
    const empMap = new Map();
    appointments.forEach(a => {
      if (a.Employee) empMap.set(String(a.Employee.id), a.Employee);
      (a.AdditionalEmployees || []).forEach(ae => {
        if (ae.Employee) empMap.set(String(ae.employeeId), ae.Employee);
      });
    });
    const missingEmpIds = new Set();
    appointments.forEach(a => {
      (Array.isArray(a.extraServices) ? a.extraServices : []).forEach(es => {
        if (es?.employeeId && !empMap.has(String(es.employeeId))) {
          missingEmpIds.add(String(es.employeeId));
        }
      });
    });
    if (missingEmpIds.size > 0) {
      const found = await Employee.findAll({
        where: { id: { [Op.in]: [...missingEmpIds] }, businessId },
        attributes: ['id', 'commissionPct'],
        include: [{ model: User, attributes: ['name'] }]
      });
      found.forEach(e => empMap.set(String(e.id), e));
    }

    const resolveEmployee = (empId) => {
      if (!empId) return null;
      return empMap.get(String(empId)) || null;
    };

    // Helper: Repartir ingresos y comisiones por empleado en la cita
    const splitByEmployee = (appt) => {
      // =========================
      // CORRECCIÓN CRÍTICA:
      // Si existe finalPrice, ese es el VALOR TOTAL REAL de la cita (incluye base + adicional - descuento)
      // NO hay que poner base=0, porque eso causaba que principalGross = 0 - extras = 0
      // =========================
      const finalPriceVal = safeFloat(appt.finalPrice);
      const baseVal = safeFloat(appt.Service?.price) || safeFloat(appt.basePrice);
      const additionalVal = safeFloat(appt.additionalAmount);
      const discount = safeFloat(appt.discountApplied);
      const extras = Array.isArray(appt.extraServices) ? appt.extraServices : [];

      const hasFinal = finalPriceVal > 0;

      const parts = []; // {employeeId, name, gross, commissionPct, isPrincipal, services: []}

      // =========================
      // 1. Servicios adicionales PRIMERO para conocer la suma
      // =========================
      const extraParts = [];
      let sumExtraPrices = 0;
      extras.forEach(es => {
        const price = safeFloat(es.price);
        sumExtraPrices += price;
        const empId = es.employeeId ? String(es.employeeId) : null;
        let empName = 'Sin asignar';
        let empComm = 0;
        if (empId) {
          const emp = resolveEmployee(empId);
          if (emp) {
            empName = emp.User?.name || empName;
            empComm = safeFloat(emp.commissionPct);
          } else if (empId === String(appt.employeeId)) {
            empName = appt.Employee?.User?.name || 'Empleado eliminado';
            empComm = safeFloat(appt.Employee?.commissionPct);
          }
        }
        extraParts.push({
          employeeId: empId || `extra-${es.serviceId || es.name}`,
          name: empName,
          commissionPct: empComm,
          gross: price,
          services: [es.name],
          isPrincipal: false,
        });
      });

      // =========================
      // 2. Empleado principal: total de la cita - suma extras
      // =========================
      let principalGross = 0;
      if (hasFinal) {
        principalGross = Math.max(0, finalPriceVal - sumExtraPrices);
      } else {
        principalGross = Math.max(0, baseVal + additionalVal - sumExtraPrices);
      }
      if (appt.employeeId) {
        parts.push({
          employeeId: String(appt.employeeId),
          name: appt.Employee?.User?.name || 'Empleado eliminado',
          commissionPct: safeFloat(appt.Employee?.commissionPct),
          gross: principalGross,
          services: [appt.Service?.name || 'Servicio eliminado'],
          isPrincipal: true,
        });
      }
      parts.push(...extraParts);

      const totalGross = parts.reduce((s, p) => s + p.gross, 0);

      // =========================
      // 3. Descuento (solo sin finalPrice) + comisión por split
      // =========================
      let totalCommissionThisApt = 0;
      const supplies = safeFloat(appt.suppliesCost);
      const totalPrice = hasFinal ? finalPriceVal : (baseVal + additionalVal - discount);

      const splits = parts.map((p, idx) => {
        let discountShare = 0;
        if (!hasFinal && discount > 0 && totalGross > 0) {
          discountShare = (p.gross / totalGross) * discount;
          if (idx === parts.length - 1) {
            const applied = parts.reduce((s, p2, i2) => {
              if (i2 >= idx) return s;
              return s + (p2.gross / totalGross) * discount;
            }, 0);
            discountShare = discount - applied;
          }
        }
        const revenue = Math.max(0, p.gross - discountShare);

        const suppliesShare = totalPrice > 0 ? (revenue / totalPrice) * supplies : 0;
        const commissionable = Math.max(0, revenue - suppliesShare);

        const hasCommission = appt.Service?.hasEmployeeCommission !== false;
        let commission;
        if (
          p.isPrincipal &&
          appt.employeeEarns !== null &&
          appt.employeeEarns !== undefined &&
          !isNaN(parseFloat(appt.employeeEarns))
        ) {
          commission = safeFloat(appt.employeeEarns);
        } else {
          commission = hasCommission && p.commissionPct > 0
            ? (commissionable * p.commissionPct) / 100
            : 0;
        }
        totalCommissionThisApt += commission;

        return {
          employeeId: p.employeeId,
          employee: p.name,
          revenue: parseFloat(revenue.toFixed(2)),
          commissionPct: p.commissionPct,
          commission: parseFloat(commission.toFixed(2)),
          isPrincipal: p.isPrincipal,
          services: p.services,
        };
      });

      const ownerEarns = Math.max(0, totalPrice - totalCommissionThisApt);

      return {
        splits,
        totalPrice,
        totalCommission: totalCommissionThisApt,
        ownerEarns,
        supplies,
      };
    };

    // Arreglo POR CITA (tabla de detalles con el detalle por split)
    const report = appointments.map(appt => {
      const { splits, totalPrice, totalCommission, ownerEarns, supplies } = splitByEmployee(appt);
      const hasFinalPrice = appt.finalPrice !== null && appt.finalPrice !== undefined && !isNaN(parseFloat(appt.finalPrice));

      const employeesSummary = splits
        .map(s => `${s.employee}${s.isPrincipal ? ' (P)' : ''} $${s.commission.toFixed(0)}`)
        .join(' + ');

      return {
        date:          appt.startTime,
        service:       appt.Service?.name || 'Servicio eliminado',
        extraServices: Array.isArray(appt.extraServices) ? appt.extraServices : [],
        client:        appt.clientName,
        price:         totalPrice,
        basePrice:     hasFinalPrice
          ? Math.max(0, totalPrice - (Array.isArray(appt.extraServices) ? appt.extraServices.reduce((s, e) => s + safeFloat(e.price), 0) : 0))
          : parseFloat(appt.Service?.price || 0),
        additional:    parseFloat(appt.additionalAmount || 0),
        supplies:      supplies,
        employee:      appt.Employee?.User?.name || 'Empleado eliminado',
        employeesSummary,
        employeeSplits: splits,
        employeeEarns: totalCommission.toFixed(2),
        ownerEarns:    ownerEarns.toFixed(2),
        hasCommission: appt.Service?.hasEmployeeCommission !== false,
        paymentMethod: appt.paymentMethod || 'cash',
      };
    });

    // =========================
    // Items POR EMPLEADO / POR CITA
    // ownerEarns por fila = revenue − commission (no reparto proporcional del sobrante)
    // =========================
    const appointmentsByEmployee = [];
    appointments.forEach(appt => {
      const { splits, totalPrice, supplies } = splitByEmployee(appt);
      const hasFinalPrice = appt.finalPrice !== null && appt.finalPrice !== undefined && !isNaN(parseFloat(appt.finalPrice));
      const principalServicePrice = hasFinalPrice
        ? Math.max(0, totalPrice - (Array.isArray(appt.extraServices) ? appt.extraServices.reduce((s, e) => s + safeFloat(e.price), 0) : 0))
        : parseFloat(appt.Service?.price || 0);

      splits.forEach((split) => {
        const suppliesShare = totalPrice > 0 ? (split.revenue / totalPrice) * supplies : 0;
        // Negocio gana = lo facturado por este tramo − lo que gana el profesional
        const ownerShare = Math.max(0, split.revenue - split.commission);

        appointmentsByEmployee.push({
          appointmentId: appt.id,
          date:          appt.startTime,
          service:       appt.Service?.name || 'Servicio eliminado',
          extraServices: Array.isArray(appt.extraServices) ? appt.extraServices : [],
          client:        appt.clientName,
          price:         split.revenue,
          employeeShare: split.revenue,
          basePrice:     split.isPrincipal ? principalServicePrice : split.revenue,
          additional:    split.isPrincipal ? parseFloat(appt.additionalAmount || 0) : 0,
          supplies:      split.isPrincipal ? supplies : 0,
          suppliesShare,
          employee:      split.employee,
          employeeId:    split.employeeId,
          isPrincipal:   split.isPrincipal,
          splitServices: split.services,
          commissionPct: split.commissionPct,
          employeeEarns: split.commission.toFixed(2),
          ownerEarns:    parseFloat(ownerShare.toFixed(2)).toFixed(2),
          hasCommission: appt.Service?.hasEmployeeCommission !== false,
          paymentMethod: appt.paymentMethod || 'cash',
        });
      });
    });

    // Totales globales
    const totals = report.reduce((acc, r) => ({
      total:         acc.total + parseFloat(r.price),
      employeeTotal: acc.employeeTotal + parseFloat(r.employeeEarns),
      ownerTotal:    acc.ownerTotal + parseFloat(r.ownerEarns),
    }), { total: 0, employeeTotal: 0, ownerTotal: 0 });

    totals.total = parseFloat(totals.total.toFixed(2));
    totals.employeeTotal = parseFloat(totals.employeeTotal.toFixed(2));
    totals.ownerTotal = parseFloat(totals.ownerTotal.toFixed(2));

    res.json({
      appointments: report,
      appointmentsByEmployee,
      totals,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

module.exports = {
  getMyCommissions,
  getCommissionReport
};
