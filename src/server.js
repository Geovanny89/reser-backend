require('dotenv').config();
const app = require('./app');
const { sequelize, BusinessType, User } = require('./models');
const bcrypt = require('bcryptjs');
const { startReminderService } = require('./services/reminderService');
const PORT = process.env.PORT || 4000;

const DEFAULT_TYPES = [
  { value: 'barberia',    label: 'Barbería',          icon: '✂️',  order: 1 },
  { value: 'spa',         label: 'Spa',               icon: '💆',  order: 2 },
  { value: 'unas',        label: 'Uñas',              icon: '💅',  order: 3 },
  { value: 'salon',       label: 'Salón de Belleza',  icon: '💇',  order: 4 },
  { value: 'peluqueria',  label: 'Peluquería',        icon: '💈',  order: 5 },
  { value: 'masajes',     label: 'Masajes',           icon: '🧖',  order: 6 },
  { value: 'tatuajes',    label: 'Tatuajes',          icon: '🎨',  order: 7 },
  { value: 'estetica',    label: 'Estética',          icon: '✨',  order: 8 },
  { value: 'veterinaria', label: 'Veterinaria',       icon: '🐾',  order: 9 },
  { value: 'otro',        label: 'Otro',              icon: '🏪',  order: 99 },
];

async function seedBusinessTypes() {
  for (const t of DEFAULT_TYPES) {
    const exists = await BusinessType.findOne({ where: { value: t.value } });
    if (!exists) await BusinessType.create(t);
  }
  console.log('✅  Tipos de negocio verificados/creados');
}

async function seedSuperAdmin() {
  const email = 'admin@admin.com';
  const exists = await User.findOne({ where: { email } });
  if (!exists) {
    const hash = await bcrypt.hash('Jose2021*', 10);
    await User.create({
      name: 'Super Admin',
      email,
      password: hash,
      role: 'superadmin',
      status: 'active'
    });
    console.log('✅  Usuario SuperAdmin creado (admin@admin.com)');
  } else {
    // Opcional: Asegurar que el rol sea superadmin y la contraseña sea la solicitada
    // por si el usuario fue creado previamente con otros datos
    const hash = await bcrypt.hash('Jose2021*', 10);
    await exists.update({ 
      role: 'superadmin',
      password: hash,
      status: 'active'
    });
    console.log('✅  Usuario SuperAdmin verificado/actualizado');
  }
}

async function start() {
  try {
    await sequelize.authenticate();
    console.log('✅  Conexión a base de datos establecida');
    await sequelize.sync({ alter: false });
    console.log('✅  Modelos sincronizados');
    await seedBusinessTypes();
    await seedSuperAdmin();
    app.listen(PORT, () => {
      console.log(`🚀  Backend corriendo en http://localhost:${PORT}`);
      console.log(`📚  Documentación Swagger: http://localhost:${PORT}/api/docs`);
      // Iniciar servicio de recordatorios automáticos (1 hora antes de cada cita)
      startReminderService();
    });
  } catch (err) {
    console.error('❌  Error al iniciar:', err);
    process.exit(1);
  }
}
start();
