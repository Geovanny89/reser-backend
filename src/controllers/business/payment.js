/**
 * Controladores para gestión de pagos y suscripciones
 */
const { Business, User, Employee } = require('../../models');
const { deleteFromCloudinary } = require('../../config/cloudinary');
const { sendEmail } = require('../../config/email');
const { SUBSCRIPTION_PLANS, ADDITIONAL_USER_PRICE } = require('./constants');

// PATCH /businesses/:id/subscription
exports.updateSubscription = async (req, res) => {
  try {
    const b = await Business.findByPk(req.params.id);
    if (!b) return res.status(404).json({ error: 'Negocio no encontrado' });
    const { subscriptionStatus, lastPaymentDate, subscriptionStartDate, subscriptionEndDate } = req.body;
    
    const updates = { 
      subscriptionStatus, 
      lastPaymentDate,
      subscriptionStartDate,
      subscriptionEndDate
    };

    if (subscriptionStatus === 'paid') {
      updates.paymentScreenshot = null;
    }

    await b.update(updates);
    res.json(b);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// POST /businesses/my/payment-screenshot
exports.uploadPaymentScreenshot = async (req, res) => {
  try {
    const b = await Business.findOne({ where: { ownerId: req.user.id } });
    if (!b) return res.status(404).json({ error: 'Negocio no encontrado' });
    if (!req.file) return res.status(400).json({ error: 'No se subió ningún archivo' });
    
    const paymentScreenshot = req.file.path;
    
    if (b.paymentScreenshot && b.paymentScreenshot !== paymentScreenshot) {
      await deleteFromCloudinary(b.paymentScreenshot);
    }
    
    await b.update({ 
      paymentScreenshot, 
      paymentScreenshotViewed: false,
      subscriptionStatus: 'pending',
      status: 'active'
    });
    
    res.json({ message: 'Comprobante subido correctamente y negocio activado', business: b });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// PATCH /businesses/:id/screenshot-viewed
exports.markScreenshotViewed = async (req, res) => {
  try {
    const b = await Business.findByPk(req.params.id);
    if (!b) return res.status(404).json({ error: 'Negocio no encontrado' });
    await b.update({ paymentScreenshotViewed: true });
    res.json({ message: 'Comprobante marcado como visto', business: b });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// POST /businesses/:id/approve-payment
exports.approvePayment = async (req, res) => {
  try {
    const b = await Business.findByPk(req.params.id, {
      include: [{ model: User, as: 'Owner', attributes: ['id', 'name', 'email'] }]
    });
    if (!b) return res.status(404).json({ error: 'Negocio no encontrado' });

    const today = new Date();
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + 30);

    await b.update({
      subscriptionStatus: 'paid',
      subscriptionStartDate: today,
      subscriptionEndDate: endDate,
      lastPaymentDate: today,
      paymentScreenshotViewed: true,
      status: 'active'
    });

    // Enviar email de confirmación
    try {
      await sendEmail(
        b.Owner?.email,
        'paymentConfirmed',
        {
          businessName: String(b.name || ''),
          ownerName: String(b.Owner?.name || 'Estimado cliente'),
          startDate: String(today.toLocaleDateString('es-CO')),
          endDate: String(endDate.toLocaleDateString('es-CO')),
          amount: String(b.paymentAmount || 60000),
        }
      );
    } catch (emailErr) {
      console.log('[Payment] Email no enviado:', emailErr.message);
    }

    res.json({ 
      message: 'Pago aprobado correctamente', 
      business: b,
      subscriptionStartDate: today,
      subscriptionEndDate: endDate
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// POST /businesses/my/submit-payment
exports.submitPayment = async (req, res) => {
  try {
    const b = await Business.findOne({ 
      where: { ownerId: req.user.id },
      include: [{ model: User, as: 'Owner', attributes: ['id', 'name', 'email'] }]
    });
    if (!b) return res.status(404).json({ error: 'Negocio no encontrado' });
    
    const { 
      paymentAmount, paymentMethod, paymentReference,
      adminNequiNumber, adminLlaveBancaria, adminBankName, adminAccountNumber
    } = req.body;

    if (!paymentAmount || !paymentMethod) {
      return res.status(400).json({ error: 'Monto y método de pago son requeridos' });
    }

    let paymentScreenshot = null;
    if (req.file) {
      paymentScreenshot = req.file.path;
      if (b.paymentScreenshot && b.paymentScreenshot !== paymentScreenshot) {
        await deleteFromCloudinary(b.paymentScreenshot);
      }
    }

    await b.update({
      paymentAmount,
      paymentMethod,
      paymentReference: paymentReference || null,
      paymentScreenshot,
      paymentScreenshotViewed: false,
      lastPaymentDate: new Date(),
      subscriptionStatus: 'pending',
      adminNequiNumber: adminNequiNumber || b.adminNequiNumber,
      adminLlaveBancaria: adminLlaveBancaria || b.adminLlaveBancaria,
      adminBankName: adminBankName || b.adminBankName,
      adminAccountNumber: adminAccountNumber || b.adminAccountNumber,
      status: 'active'
    });

    // Notificar al admin
    const adminEmail = process.env.ADMIN_EMAIL || 'notificaciones@k-dice.com';
    try {
      await sendEmail(
        adminEmail,
        'newPaymentNotification',
        {
          businessName: String(b.name || ''),
          ownerName: String(b.Owner?.name || 'Sin nombre'),
          ownerEmail: String(b.Owner?.email || 'Sin email'),
          amount: String(paymentAmount || ''),
          paymentMethod: String(paymentMethod || ''),
          paymentReference: String(paymentReference || 'N/A'),
          nequiNumber: String(adminNequiNumber || ''),
          llaveBancaria: String(adminLlaveBancaria || ''),
          bankName: String(adminBankName || ''),
          accountNumber: String(adminAccountNumber || ''),
          paymentDate: String(new Date()),
        }
      );
      console.log(`[Payment] Notificación enviada a admin para pago de ${b.name}`);
    } catch (emailError) {
      console.error('[Payment] Error enviando notificación:', emailError.message);
    }

    res.json({ 
      message: 'Pago registrado correctamente. Está pendiente de verificación.', 
      business: b 
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// GET /businesses/:id/subscription-info
exports.getSubscriptionInfo = async (req, res) => {
  try {
    let businessId = req.params.id || req.query.businessId;
    if (!businessId) return res.status(400).json({ error: 'businessId es requerido' });
    
    if (businessId === 'my') {
      const userId = req.user.id;
      const user = await User.findByPk(userId);
      
      const ownedBiz = await Business.findOne({ where: { ownerId: userId } });
      
      if (ownedBiz) {
        businessId = ownedBiz.id;
      } else if (user && user.employeeId) {
        const employee = await Employee.findByPk(user.employeeId);
        if (employee && employee.businessId) {
          businessId = employee.businessId;
        }
      }
      
      if (businessId === 'my') {
        return res.status(404).json({ error: 'No tienes un negocio registrado' });
      }
    }
    
    const business = await Business.findByPk(businessId);
    if (!business) return res.status(404).json({ error: 'Negocio no encontrado' });
    
    const userId = req.user.id;
    const isOwner = business.ownerId === userId;
    
    if (!isOwner) {
      const emp = await Employee.findOne({ 
        where: { userId, businessId, isManager: true } 
      });
      if (!emp && req.user.role !== 'admin_suc') {
        return res.status(403).json({ error: 'Sin permisos para ver este negocio' });
      }
    }
    
    // Contar empleados activos (incluir active: true o active: null para compatibilidad)
    const { Op } = require('sequelize');
    
    // DEBUG: Verificar qué empleados existen para este negocio
    const allEmployees = await Employee.findAll({
      where: { businessId },
      attributes: ['id', 'active', 'businessId'],
      raw: true
    });
    console.log(`[getSubscriptionInfo] DEBUG businessId=${businessId}, found ${allEmployees.length} employees:`, allEmployees);
    
    const employeeCount = await Employee.count({
      where: {
        businessId,
        active: { [Op.or]: [true, null] }
      },
      include: [{
        model: User,
        where: { role: { [Op.notIn]: ['admin', 'admin_suc'] } },
        required: true
      }],
      distinct: true,
      col: 'id'
    });
    console.log(`[getSubscriptionInfo] DEBUG employeeCount=${employeeCount} (after filtering active, excluding admin/admin_suc)`);
    
    const totalUsersAllowed = business.includedUsers + business.additionalUsers;
    const availableUsers = totalUsersAllowed - employeeCount;
    
    const planInfo = SUBSCRIPTION_PLANS[business.subscriptionPlan] || SUBSCRIPTION_PLANS.basic;
    
    res.json({
      subscriptionPlan: business.subscriptionPlan,
      planName: planInfo.name,
      basePrice: planInfo.price,
      includedUsers: business.includedUsers,
      additionalUsers: business.additionalUsers,
      additionalUserPrice: business.additionalUserPrice,
      monthlyTotal: business.monthlyTotal,
      customMonthlyPrice: business.customMonthlyPrice,
      isCustomPrice: business.customMonthlyPrice !== null && business.customMonthlyPrice !== undefined,
      currentEmployees: employeeCount,
      totalUsersAllowed: totalUsersAllowed,
      availableUsers: availableUsers,
      canAddMore: availableUsers > 0,
      adminExcluded: true
    });
  } catch (e) {
    console.error('[getSubscriptionInfo] Error:', e);
    res.status(500).json({ error: e.message });
  }
};

// PUT /businesses/:id/subscription-plan
exports.updateSubscriptionPlan = async (req, res) => {
  try {
    const { id } = req.params;
    const { subscriptionPlan, additionalUsers, customMonthlyPrice } = req.body;
    
    const business = await Business.findByPk(id);
    if (!business) return res.status(404).json({ error: 'Negocio no encontrado' });
    
    if (!SUBSCRIPTION_PLANS[subscriptionPlan]) {
      return res.status(400).json({ error: 'Plan no válido. Opciones: basic, pro, premium' });
    }
    
    const planInfo = SUBSCRIPTION_PLANS[subscriptionPlan];
    const additional = Math.max(0, parseInt(additionalUsers) || 0);
    
    // Si hay un precio personalizado, usarlo; si no, calcular según el plan
    let monthlyTotal;
    let customPriceValue = null;
    
    if (customMonthlyPrice !== undefined && customMonthlyPrice !== null && customMonthlyPrice !== '') {
      const parsedPrice = parseInt(customMonthlyPrice);
      if (!isNaN(parsedPrice) && parsedPrice > 0) {
        monthlyTotal = parsedPrice;
        customPriceValue = parsedPrice;
      } else {
        monthlyTotal = planInfo.price + (additional * ADDITIONAL_USER_PRICE);
        customPriceValue = null; // Resetear si se envía valor inválido
      }
    } else {
      monthlyTotal = planInfo.price + (additional * ADDITIONAL_USER_PRICE);
      customPriceValue = null; // Resetear si no se envía
    }
    
    await business.update({
      subscriptionPlan,
      includedUsers: planInfo.includedUsers,
      additionalUsers: additional,
      monthlyTotal,
      customMonthlyPrice: customPriceValue,
      additionalUserPrice: ADDITIONAL_USER_PRICE
    });
    
    res.json({
      message: 'Plan actualizado correctamente',
      subscriptionPlan,
      planName: planInfo.name,
      includedUsers: planInfo.includedUsers,
      additionalUsers: additional,
      monthlyTotal,
      customMonthlyPrice: customPriceValue,
      isCustomPrice: customPriceValue !== null
    });
  } catch (e) {
    console.error('[updateSubscriptionPlan] Error:', e);
    res.status(500).json({ error: e.message });
  }
};

// POST /businesses/:id/additional-users
exports.addAdditionalUsers = async (req, res) => {
  try {
    const { id } = req.params;
    const { count } = req.body;
    
    if (!count || count < 1) {
      return res.status(400).json({ error: 'Debes agregar al menos 1 usuario adicional' });
    }
    
    const business = await Business.findByPk(id);
    if (!business) return res.status(404).json({ error: 'Negocio no encontrado' });
    
    const newAdditionalUsers = business.additionalUsers + parseInt(count);
    
    // Calcular el nuevo total: si hay precio personalizado, usarlo como base
    let monthlyTotal;
    if (business.customMonthlyPrice !== null && business.customMonthlyPrice !== undefined) {
      // Si hay precio personalizado, calcular: customPrice + (usuarios adicionales * precio por usuario)
      monthlyTotal = business.customMonthlyPrice + (newAdditionalUsers * ADDITIONAL_USER_PRICE);
    } else {
      // Si no hay precio personalizado, usar el precio del plan
      const planInfo = SUBSCRIPTION_PLANS[business.subscriptionPlan] || SUBSCRIPTION_PLANS.basic;
      monthlyTotal = planInfo.price + (newAdditionalUsers * ADDITIONAL_USER_PRICE);
    }
    
    await business.update({
      additionalUsers: newAdditionalUsers,
      monthlyTotal
    });
    
    res.json({
      message: `Se agregaron ${count} usuarios adicionales`,
      additionalUsers: newAdditionalUsers,
      monthlyTotal,
      extraCost: count * ADDITIONAL_USER_PRICE
    });
  } catch (e) {
    console.error('[addAdditionalUsers] Error:', e);
    res.status(500).json({ error: e.message });
  }
};
