const { Business } = require('./src/models');

async function migrateReferralCodes() {
  try {
    const businesses = await Business.findAll();
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

    console.log(`Actualizando ${businesses.length} negocios con códigos nuevos.`);

    for (const b of businesses) {
      let code = '';
      let isUnique = false;
      
      while (!isUnique) {
        code = '';
        for (let i = 0; i < 6; i++) {
          code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        const existing = await Business.findOne({ where: { referralCode: code } });
        if (!existing) isUnique = true;
      }

      await b.update({ referralCode: code });
      console.log(`Nuevo código ${code} asignado a ${b.name}`);
    }

    console.log('Migración completada con éxito.');
    process.exit(0);
  } catch (err) {
    console.error('Error en la migración:', err);
    process.exit(1);
  }
}

migrateReferralCodes();
