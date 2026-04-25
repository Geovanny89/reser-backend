/**
 * Perfil e información de empleados - Versión Original
 */

const { Employee, User, Business, Service } = require('../../models');

/**
 * Obtener información del empleado con su negocio
 */
async function getEmployeeInfo(req, res) {
  try {
    const userId = req.user.id;

    const employee = await Employee.findOne({
      where: { userId },
      include: [
        { model: User, attributes: ['id', 'name', 'email'] },
        { model: Business, attributes: ['id', 'name', 'slug', 'type', 'logoUrl', 'isTechnicalServices', 'hasFieldTechnicians'] },
        { 
          model: Service, 
          as: 'Services',
          attributes: ['id', 'name', 'price', 'durationMin', 'imageUrl'],
          through: { attributes: [] }
        }
      ]
    });

    if (!employee) {
      return res.status(404).json({ error: 'Empleado no encontrado' });
    }

    res.json({
      id: employee.id,
      businessId: employee.businessId,
      commissionPct: employee.commissionPct,
      ownerPct: employee.ownerPct,
      specialty: employee.specialty,
      specialties: employee.specialties,
      photoUrl: employee.photoUrl,
      description: employee.description,
      active: employee.active,
      isManager: employee.isManager,
      user: employee.User,
      business: employee.Business,
      services: employee.Services || []
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/**
 * Actualizar perfil del empleado logueado
 */
async function updateMyProfile(req, res) {
  try {
    const userId = req.user.id;
    const { specialty, description, photoUrl, specialties } = req.body;

    const employee = await Employee.findOne({
      where: { userId },
      include: [
        { model: User, attributes: ['id', 'name', 'email'] },
        { model: Business, attributes: ['id', 'name', 'slug', 'type'] }
      ]
    });

    if (!employee) {
      return res.status(404).json({ error: 'Empleado no encontrado' });
    }

    // Solo permitir actualizar ciertos campos
    const updates = {};
    if (specialty !== undefined) updates.specialty = specialty;
    if (description !== undefined) updates.description = description;
    if (photoUrl !== undefined) updates.photoUrl = photoUrl;
    if (specialties !== undefined) updates.specialties = specialties;

    await employee.update(updates);

    res.json({
      message: 'Perfil actualizado correctamente',
      employee: {
        id: employee.id,
        specialty: employee.specialty,
        specialties: employee.specialties,
        photoUrl: employee.photoUrl,
        description: employee.description,
        user: employee.User,
        business: employee.Business
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

module.exports = {
  getEmployeeInfo,
  updateMyProfile
};
