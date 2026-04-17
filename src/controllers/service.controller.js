const { Service, Business, Promotion, ServiceGroup } = require('../models');
const { Op } = require('sequelize');
const { deleteFromCloudinary } = require('../config/cloudinary');

exports.getByBusiness = async (req, res) => {
  try {
    const businessId = req.params.businessId || req.query.businessId;
    if (!businessId) return res.status(400).json({ error: 'businessId es requerido' });
    
    const now = new Date();
    
    // Obtener promociones generales del negocio
    const generalPromotions = await Promotion.findAll({
      where: {
        businessId,
        active: true,
        applyToAllServices: true,
        startDate: { [Op.lte]: now },
        endDate: { [Op.gte]: now }
      }
    });

    const services = await Service.findAll({
      where: { businessId, active: true },
      include: [
        {
          model: Promotion,
          as: 'Promotions',
          where: {
            active: true,
            applyToAllServices: false,
            startDate: { [Op.lte]: now },
            endDate: { [Op.gte]: now }
          },
          required: false
        },
        {
          model: ServiceGroup,
          as: 'Group',
          required: false
        }
      ]
    });

    // Combinar promociones generales con cada servicio
    const servicesWithPromos = services.map(s => {
      const serviceJson = s.toJSON();
      // Si el servicio no tiene una promoción específica, añadir la general si existe
      if ((!serviceJson.Promotions || serviceJson.Promotions.length === 0) && generalPromotions.length > 0) {
        serviceJson.Promotions = generalPromotions;
      }
      return serviceJson;
    });

    res.json(servicesWithPromos);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.create = async (req, res) => {
  try {
    const { name, description, price, durationMin, isTechnicalService, priceOptional, hasEmployeeCommission, businessId, imageUrl, color } = req.body;
    const userId = req.user.id;

    // Si viene businessId, lo usamos. Si no, buscamos el negocio del usuario
    let finalBusinessId = businessId;

    if (!finalBusinessId) {
      // 1. Buscar si el usuario es el DUEÑO de algún negocio
      const biz = await Business.findOne({ where: { ownerId: userId, isBranch: false } });
      if (biz) {
        finalBusinessId = biz.id;
      } else {
        // 2. Si no es dueño, buscar si es un EMPLEADO con rol de administrador (isManager)
        const { Employee } = require('../models');
        const emp = await Employee.findOne({ where: { userId, isManager: true } });
        if (emp) {
          finalBusinessId = emp.businessId;
        }
      }
    }

    if (!finalBusinessId) {
      return res.status(404).json({ error: 'No se pudo encontrar un negocio asociado a tu cuenta' });
    }

    // Convertir precio vacío a null
    const parsedPrice = price === '' || price === undefined ? null : parseFloat(price);

    const service = await Service.create({
      businessId: finalBusinessId,
      name,
      description,
      price: parsedPrice,
      durationMin,
      isTechnicalService: isTechnicalService || false,
      priceOptional: priceOptional || false,
      hasEmployeeCommission: hasEmployeeCommission !== false, // default true
      imageUrl: imageUrl || null,
      color: color || '#3b82f6'
    });
    res.status(201).json(service);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};

exports.update = async (req, res) => {
  try {
    const service = await Service.findByPk(req.params.id);
    if (!service) return res.status(404).json({ error: 'Servicio no encontrado' });
    
    const updateData = { ...req.body };
    
    // Convertir precio vacío a null
    if (updateData.price === '' || updateData.price === undefined) {
      updateData.price = null;
    } else if (updateData.price !== null) {
      updateData.price = parseFloat(updateData.price);
    }
    
    // Asegurar booleanos
    if (updateData.isTechnicalService !== undefined) {
      updateData.isTechnicalService = !!updateData.isTechnicalService;
    }
    if (updateData.priceOptional !== undefined) {
      updateData.priceOptional = !!updateData.priceOptional;
    }
    if (updateData.hasEmployeeCommission !== undefined) {
      updateData.hasEmployeeCommission = updateData.hasEmployeeCommission !== false;
    }
    if (updateData.color !== undefined) {
      updateData.color = updateData.color || '#3b82f6';
    }
    
    // Manejar serviceGroupId: convertir string vacío a null
    if (updateData.serviceGroupId !== undefined) {
      updateData.serviceGroupId = updateData.serviceGroupId || null;
    }

    // ELIMINAR FOTO ANTERIOR DE CLOUDINARY SI CAMBIA
    if (updateData.imageUrl && service.imageUrl && updateData.imageUrl !== service.imageUrl) {
      await deleteFromCloudinary(service.imageUrl);
    }
    
    await service.update(updateData);

    // SI LA DURACIÓN O CUALQUIER OTRO DATO RELEVANTE CAMBIÓ, 
    // ACTUALIZAR EL endTime DE TODAS LAS CITAS QUE AÚN NO SE HAN COMPLETADO
    if (req.body.durationMin !== undefined) {
      const { Appointment } = require('../models');
      const { Op } = require('sequelize');
      const newDuration = parseInt(req.body.durationMin);
      
      // Buscar todas las citas que NO estén terminadas ni canceladas
      const futureAppointments = await Appointment.findAll({
        where: {
          serviceId: service.id,
          status: { [Op.in]: ['pending', 'confirmed', 'attention'] }
        }
      });

      // Actualizar cada cita individualmente para recalcular su endTime
      for (const appt of futureAppointments) {
        const start = new Date(appt.startTime);
        const newEnd = new Date(start.getTime() + newDuration * 60000);
        await appt.update({ endTime: newEnd });
      }
      console.log(`[ServiceUpdate] Forzada actualización de ${futureAppointments.length} citas por cambio a ${newDuration} min`);
    }

    // Recargar el servicio con su grupo para devolverlo actualizado
    const updatedService = await Service.findByPk(service.id, {
      include: [{
        model: ServiceGroup,
        as: 'Group',
        required: false
      }]
    });

    res.json(updatedService);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const service = await Service.findByPk(req.params.id);
    if (!service) return res.status(404).json({ error: 'Servicio no encontrado' });
    await service.update({ active: false });
    res.json({ message: 'Servicio desactivado' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
