const { BirthdayTemplate, ClientProfile, Appointment, Business, User, WhatsAppSession, Op } = require('../../models');
const axios = require('axios');

/**
 * Gestión de plantillas de cumpleaños
 */
async function getTemplates(businessId) {
  return await BirthdayTemplate.findAll({
    where: { businessId },
    order: [['createdAt', 'ASC']]
  });
}

async function saveTemplate(data) {
  const { id, businessId, content, isActive } = data;
  
  if (id) {
    const template = await BirthdayTemplate.findByPk(id);
    if (!template) throw new Error('Plantilla no encontrada');
    await template.update({ content, isActive: isActive !== undefined ? isActive : template.isActive });
    return template;
  } else {
    // Verificar limite de 10 plantillas
    const count = await BirthdayTemplate.count({ where: { businessId } });
    if (count >= 10) throw new Error('Máximo 10 plantillas permitidas');
    
    return await BirthdayTemplate.create({
      businessId,
      content,
      isActive: isActive !== undefined ? isActive : true
    });
  }
}

async function deleteTemplate(id) {
  const template = await BirthdayTemplate.findByPk(id);
  if (!template) throw new Error('Plantilla no encontrada');
  await template.destroy();
  return { success: true };
}

module.exports = {
  getTemplates,
  saveTemplate,
  deleteTemplate
};
