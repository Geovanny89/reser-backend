/**
 * Gestión de clientes y etiquetas
 */

const { Appointment, Service, Employee, User, Business, ClientTag, ClientTagAssignment, ClientProfile, Op } = require('../../models');

/**
 * Obtiene lista de clientes únicos con estadísticas para un negocio
 */
async function getClientsByBusiness(businessId, search = null) {
  const where = { businessId };
  
  if (search) {
    where[Op.or] = [
      { clientName: { [Op.like]: `%${search}%` } },
      { clientPhone: { [Op.like]: `%${search}%` } },
      { clientEmail: { [Op.like]: `%${search}%` } }
    ];
  }

  const [appointments, tagAssignments, availableTags, profiles] = await Promise.all([
    Appointment.findAll({
      where,
      include: [
        { model: Service, attributes: ['id', 'name', 'price'] },
        { model: Employee, include: [{ model: User, attributes: ['name'] }] }
      ],
      order: [['startTime', 'DESC']]
    }),
    ClientTagAssignment.findAll({
      where: { businessId },
      include: [{ model: ClientTag, as: 'Tag', where: { active: true }, required: false }]
    }),
    ClientTag.findAll({
      where: { businessId, active: true },
      attributes: ['id', 'name', 'color']
    }),
    ClientProfile.findAll({
      where: { businessId }
    })
  ]);

  // Crear mapa de perfiles (cumpleaños)
  const profilesByClient = new Map();
  profiles.forEach(p => {
    if (p.clientPhone) profilesByClient.set(p.clientPhone, p.birthday);
    if (p.clientEmail) profilesByClient.set(p.clientEmail, p.birthday);
  });

  // Crear mapa de etiquetas por cliente
  const tagsByClient = new Map();
  tagAssignments.forEach(assignment => {
    if (!assignment.Tag) return;
    const key = assignment.clientPhone || assignment.clientEmail;
    if (!key) return;
    
    if (!tagsByClient.has(key)) {
      tagsByClient.set(key, []);
    }
    tagsByClient.get(key).push({
      id: assignment.Tag.id,
      name: assignment.Tag.name,
      color: assignment.Tag.color,
      assignmentId: assignment.id
    });
  });

  // Agrupar por cliente
  const clientsMap = new Map();

  // 1. Primero procesar citas (fuente principal de nombres y datos)
  appointments.forEach(appt => {
    const key = appt.clientPhone || appt.clientEmail || appt.clientName || 'Sin contacto';
    
    if (!clientsMap.has(key)) {
      clientsMap.set(key, {
        id: appt.clientId,
        name: appt.clientName || 'Sin nombre',
        phone: appt.clientPhone || null,
        email: appt.clientEmail || null,
        birthday: profilesByClient.get(appt.clientPhone) || profilesByClient.get(appt.clientEmail) || null,
        totalAppointments: 0,
        completedAppointments: 0,
        cancelledAppointments: 0,
        totalSpent: 0,
        lastVisit: null,
        firstVisit: null,
        tags: tagsByClient.get(appt.clientPhone) || tagsByClient.get(appt.clientEmail) || [],
        appointments: []
      });
    }

    const client = clientsMap.get(key);
    client.totalAppointments++;
    
    if (appt.status === 'done') {
      client.completedAppointments++;
      client.totalSpent += parseFloat(appt.finalPrice || appt.basePrice || 0);
    } else if (appt.status === 'cancelled') {
      client.cancelledAppointments++;
    }

    const apptDate = new Date(appt.startTime);
    if (!client.lastVisit || apptDate > new Date(client.lastVisit)) {
      client.lastVisit = appt.startTime;
    }
    if (!client.firstVisit || apptDate < new Date(client.firstVisit)) {
      client.firstVisit = appt.startTime;
    }

    client.appointments.push({
      id: appt.id,
      date: appt.startTime,
      service: appt.Service?.name || 'Sin servicio',
      employee: appt.Employee?.User?.name || 'Sin empleado',
      status: appt.status,
      price: appt.finalPrice || appt.basePrice || 0
    });
  });

  // 2. Procesar asignaciones de etiquetas (pueden tener nombres de clientes sin citas)
  tagAssignments.forEach(tag => {
    const key = tag.clientPhone || tag.clientEmail || tag.clientName;
    if (!key) return;

    if (!clientsMap.has(key)) {
      clientsMap.set(key, {
        id: null,
        name: tag.clientName || 'Sin nombre',
        phone: tag.clientPhone || null,
        email: tag.clientEmail || null,
        birthday: profilesByClient.get(tag.clientPhone) || profilesByClient.get(tag.clientEmail) || null,
        totalAppointments: 0,
        completedAppointments: 0,
        cancelledAppointments: 0,
        totalSpent: 0,
        lastVisit: null,
        firstVisit: null,
        tags: tagsByClient.get(tag.clientPhone) || tagsByClient.get(tag.clientEmail) || [],
        appointments: []
      });
    }
  });

  // 3. Procesar perfiles (para asegurar que clientes con solo perfil/cumpleaños aparezcan)
  profiles.forEach(p => {
    const key = p.clientPhone || p.clientEmail;
    if (!key) return;

    if (!clientsMap.has(key)) {
      clientsMap.set(key, {
        id: null,
        name: 'Cliente sin nombre', // No tenemos nombre en profiles
        phone: p.clientPhone || null,
        email: p.clientEmail || null,
        birthday: p.birthday || null,
        totalAppointments: 0,
        completedAppointments: 0,
        cancelledAppointments: 0,
        totalSpent: 0,
        lastVisit: null,
        firstVisit: null,
        tags: tagsByClient.get(p.clientPhone) || tagsByClient.get(p.clientEmail) || [],
        appointments: []
      });
    }
  });

  const clients = Array.from(clientsMap.values());
  return {
    total: clients.length,
    availableTags,
    clients: clients.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
  };
}

/**
 * CRUD de etiquetas
 */
async function getClientTags(businessId) {
  return await ClientTag.findAll({
    where: { businessId, active: true },
    order: [['name', 'ASC']]
  });
}

async function createClientTag(data) {
  const { businessId, name, color, description } = data;
  return await ClientTag.create({
    businessId,
    name: name.trim(),
    color: color || '#4F46E5',
    description: description || null,
    active: true
  });
}

async function updateClientTag(id, data) {
  const { name, color, description } = data;
  const tag = await ClientTag.findByPk(id);
  if (!tag) throw new Error('Etiqueta no encontrada');
  
  await tag.update({
    name: name?.trim() || tag.name,
    color: color || tag.color,
    description: description !== undefined ? description : tag.description
  });
  return tag;
}

async function deleteClientTag(id) {
  const tag = await ClientTag.findByPk(id);
  if (!tag) throw new Error('Etiqueta no encontrada');
  
  await tag.update({ active: false });
  return { success: true };
}

/**
 * Asignar/quitar etiquetas de clientes
 */
async function assignTagToClient(data) {
  const { businessId, clientTagId, clientPhone, clientEmail, clientName, notes } = data;

  if (!businessId || !clientTagId || (!clientPhone && !clientEmail)) {
    throw new Error('businessId, clientTagId y clientPhone o clientEmail son requeridos');
  }

  // Verificar que la etiqueta existe y pertenece al negocio
  const tag = await ClientTag.findOne({
    where: { id: clientTagId, businessId, active: true }
  });
  if (!tag) throw new Error('Etiqueta no encontrada');

  // Verificar si ya existe esta asignación
  const existingAssignment = await ClientTagAssignment.findOne({
    where: {
      businessId,
      clientTagId,
      clientPhone: clientPhone || null,
      clientEmail: clientEmail ? clientEmail.toLowerCase().trim() : null
    }
  });

  if (existingAssignment) {
    throw new Error('Esta etiqueta ya está asignada a este cliente');
  }

  const assignment = await ClientTagAssignment.create({
    businessId,
    clientTagId,
    clientPhone: clientPhone || null,
    clientEmail: clientEmail ? clientEmail.toLowerCase().trim() : null,
    clientName: clientName || null,
    notes: notes || null
  });

  return {
    ...assignment.toJSON(),
    Tag: tag
  };
}

async function removeTagFromClient(assignmentId) {
  const assignment = await ClientTagAssignment.findByPk(assignmentId);
  if (!assignment) throw new Error('Asignación no encontrada');
  
  await assignment.destroy();
  return { success: true };
}

/**
 * Actualiza datos de un cliente en todas sus citas y su perfil
 */
async function updateClientData(businessId, originalPhone, originalEmail, newName, newPhone, newEmail, birthday) {
  const where = { businessId };
  
  if (originalPhone) where.clientPhone = originalPhone;
  else if (originalEmail) where.clientEmail = originalEmail;
  else throw new Error('Se requiere teléfono o email original');

  const updateData = {};
  if (newName) updateData.clientName = newName.trim();
  if (newPhone) updateData.clientPhone = newPhone.replace(/\D/g, '');
  if (newEmail) updateData.clientEmail = newEmail.toLowerCase().trim();

  // Actualizar citas
  const [updatedCount] = await Appointment.update(updateData, { where });

  // Actualizar o crear perfil de cliente (cumpleaños)
  if (birthday !== undefined) {
    const profileWhere = { businessId };
    if (originalPhone) profileWhere.clientPhone = originalPhone;
    else if (originalEmail) profileWhere.clientEmail = originalEmail;

    const [profile, created] = await ClientProfile.findOrCreate({
      where: profileWhere,
      defaults: {
        businessId,
        clientPhone: newPhone || originalPhone,
        clientEmail: newEmail || originalEmail,
        birthday: birthday || null
      }
    });

    if (!created) {
      await profile.update({
        clientPhone: newPhone || profile.clientPhone,
        clientEmail: newEmail || profile.clientEmail,
        birthday: birthday || null
      });
    }
  }
  
  return { updatedCount };
}

/**
 * Construye el where para identificar citas de un cliente virtual
 * (teléfono → email → nombre sin contacto)
 */
function buildClientAppointmentWhere(businessId, client) {
  const where = { businessId };
  const rawPhone = client?.phone ? String(client.phone).replace(/\D/g, '') : '';
  const phone = rawPhone ? rawPhone.slice(-10) : null;
  const email = client?.email ? String(client.email).toLowerCase().trim() : null;
  const name = client?.name ? String(client.name).trim() : null;

  if (phone) {
    // Coincidir teléfono completo o últimos 10 dígitos
    where[Op.or] = [
      { clientPhone: phone },
      { clientPhone: { [Op.like]: `%${phone}` } }
    ];
  } else if (email) {
    where.clientEmail = email;
  } else if (name) {
    where.clientName = name;
    where[Op.and] = [
      {
        [Op.or]: [
          { clientPhone: null },
          { clientPhone: '' }
        ]
      },
      {
        [Op.or]: [
          { clientEmail: null },
          { clientEmail: '' }
        ]
      }
    ];
  } else {
    throw new Error('Se requiere teléfono, email o nombre del cliente');
  }
  return where;
}

function clientIdentityKey(client) {
  const phone = client?.phone ? String(client.phone).replace(/\D/g, '').slice(-10) : '';
  const email = client?.email ? String(client.email).toLowerCase().trim() : '';
  const name = client?.name ? String(client.name).trim().toLowerCase() : '';
  if (phone) return `p:${phone}`;
  if (email) return `e:${email}`;
  if (name) return `n:${name}`;
  return null;
}

/**
 * Fusiona un cliente duplicado en otro.
 * Las citas (incluidas las atendidas) se conservan y pasan al cliente destino.
 * El duplicado desaparece de la lista porque ya no quedan citas con su clave.
 */
async function mergeClients(businessId, source, target) {
  if (!businessId) throw new Error('businessId es requerido');
  if (!source || !target) throw new Error('Cliente origen y destino son requeridos');

  const sourceKey = clientIdentityKey(source);
  const targetKey = clientIdentityKey(target);
  if (!sourceKey) throw new Error('El cliente a eliminar no tiene identificación válida');
  if (!targetKey) throw new Error('Selecciona el cliente que se conservará');
  if (sourceKey === targetKey) throw new Error('No puedes fusionar un cliente consigo mismo');

  const sourceWhere = buildClientAppointmentWhere(businessId, source);
  const targetWhere = buildClientAppointmentWhere(businessId, target);

  const targetAppt = await Appointment.findOne({
    where: targetWhere,
    attributes: ['clientId', 'clientName', 'clientPhone', 'clientEmail']
  });

  const cleanPhone = target.phone
    ? String(target.phone).replace(/\D/g, '').slice(-10)
    : (targetAppt?.clientPhone || null);
  const cleanEmail = target.email
    ? String(target.email).toLowerCase().trim()
    : (targetAppt?.clientEmail || null);
  const cleanName = (target.name || targetAppt?.clientName || source.name || 'Sin nombre').trim();

  const updateData = {
    clientName: cleanName,
    clientPhone: cleanPhone || null,
    clientEmail: cleanEmail || null
  };
  if (targetAppt?.clientId) {
    updateData.clientId = targetAppt.clientId;
  }

  const [updatedCount] = await Appointment.update(updateData, { where: sourceWhere });

  // Mover etiquetas del origen al destino (si el origen tenía teléfono/email)
  const tagWhere = { businessId };
  if (source.phone) {
    const p = String(source.phone).replace(/\D/g, '');
    tagWhere.clientPhone = p.length >= 10 ? p.slice(-10) : p;
  } else if (source.email) {
    tagWhere.clientEmail = String(source.email).toLowerCase().trim();
  }

  if (tagWhere.clientPhone || tagWhere.clientEmail) {
    const assignments = await ClientTagAssignment.findAll({ where: tagWhere });
    for (const assignment of assignments) {
      const existsWhere = {
        businessId,
        clientTagId: assignment.clientTagId,
        clientPhone: cleanPhone || null,
        clientEmail: cleanEmail || null
      };
      const exists = await ClientTagAssignment.findOne({ where: existsWhere });
      if (exists) {
        await assignment.destroy();
      } else {
        await assignment.update({
          clientPhone: cleanPhone || null,
          clientEmail: cleanEmail || null,
          clientName: cleanName
        });
      }
    }
  }

  // Perfil/cumpleaños: si el origen tenía y el destino no, moverlo
  if (source.phone || source.email) {
    const profileWhere = { businessId };
    if (source.phone) profileWhere.clientPhone = String(source.phone).replace(/\D/g, '').slice(-10);
    else profileWhere.clientEmail = String(source.email).toLowerCase().trim();

    const sourceProfile = await ClientProfile.findOne({ where: profileWhere });
    if (sourceProfile) {
      const destWhere = { businessId };
      if (cleanPhone) destWhere.clientPhone = cleanPhone;
      else if (cleanEmail) destWhere.clientEmail = cleanEmail;

      let destProfile = null;
      if (cleanPhone || cleanEmail) {
        destProfile = await ClientProfile.findOne({ where: destWhere });
      }

      if (destProfile) {
        if (!destProfile.birthday && sourceProfile.birthday) {
          await destProfile.update({ birthday: sourceProfile.birthday });
        }
        await sourceProfile.destroy();
      } else if (cleanPhone || cleanEmail) {
        await sourceProfile.update({
          clientPhone: cleanPhone || sourceProfile.clientPhone,
          clientEmail: cleanEmail || sourceProfile.clientEmail
        });
      } else {
        await sourceProfile.destroy();
      }
    }
  }

  return {
    updatedCount,
    message: updatedCount > 0
      ? `Cliente fusionado. ${updatedCount} cita(s) conservada(s) en el cliente destino.`
      : 'No se encontraron citas del cliente duplicado para fusionar.'
  };
}

module.exports = {
  getClientsByBusiness,
  getClientTags,
  createClientTag,
  updateClientTag,
  deleteClientTag,
  assignTagToClient,
  removeTagFromClient,
  updateClientData,
  mergeClients
};
