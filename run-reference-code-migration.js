/**
 * Script para ejecutar la migración de códigos de referencia
 * Ejecuta: node run-reference-code-migration.js
 */
const sequelize = require('./src/config/database');

async function runMigration() {
  try {
    console.log('🔧 Conectando a la base de datos...');
    await sequelize.authenticate();
    console.log('✅ Conexión establecida');

    // Verificar si la columna ya existe
    const [columns] = await sequelize.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'Appointments'
    `);

    const existingColumns = columns.map(c => c.column_name);

    // Agregar referenceCode
    if (!existingColumns.includes('referenceCode')) {
      console.log('📦 Agregando columna referenceCode...');
      await sequelize.query(`
        ALTER TABLE "Appointments"
        ADD COLUMN "referenceCode" VARCHAR(8) NULL UNIQUE
      `);
      console.log('✅ Columna referenceCode agregada');

      // Crear índice
      await sequelize.query(`
        CREATE INDEX IF NOT EXISTS appointments_reference_code_idx
        ON "Appointments"("referenceCode")
      `);
      console.log('✅ Índice appointments_reference_code_idx creado');
    } else {
      console.log('ℹ️ Columna referenceCode ya existe');
    }

    // Generar códigos para citas existentes sin código
    const { generateRandomCode } = require('./src/utils/referenceCode');

    const [appointmentsWithoutCode] = await sequelize.query(`
      SELECT id, "referenceCode"
      FROM "Appointments"
      WHERE "referenceCode" IS NULL
    `);

    console.log(`\n📦 Generando códigos para ${appointmentsWithoutCode.length} citas existentes...`);

    let updated = 0;
    for (const appt of appointmentsWithoutCode) {
      let code;
      let attempts = 0;
      let inserted = false;

      while (attempts < 10 && !inserted) {
        code = generateRandomCode();
        attempts++;

        try {
          await sequelize.query(`
            UPDATE "Appointments"
            SET "referenceCode" = :code
            WHERE id = :id
          `, {
            replacements: { code, id: appt.id }
          });
          inserted = true;
          updated++;
        } catch (err) {
          // Si hay error de duplicado, intentar con otro código
          if (err.message.includes('duplicate') || err.message.includes('unique')) {
            console.log(`  ⚠️ Colisión para ${code}, reintentando...`);
          } else {
            throw err;
          }
        }
      }
    }

    console.log(`✅ ${updated} citas actualizadas con código de referencia`);

    console.log('\n✅ Migración completada exitosamente');

    // Verificar
    const [results] = await sequelize.query(`
      SELECT COUNT(*) as total, COUNT("referenceCode") as with_code
      FROM "Appointments"
    `);

    console.log(`\n📋 Resumen:`);
    console.log(`  - Total citas: ${results[0].total}`);
    console.log(`  - Con código: ${results[0].with_code}`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Error en la migración:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

runMigration();
