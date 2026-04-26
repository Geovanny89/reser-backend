/**
 * Script para generar comandos SQL para limpiar índices duplicados
 * 
 * Este script se conecta a la base de datos y genera los comandos SQL
 * necesarios para eliminar los índices duplicados de forma segura.
 * 
 * Uso:
 *   NODE_ENV=production node generate-cleanup-duplicate-indexes.js
 * 
 * El script generará un archivo cleanup-duplicate-indexes-generated.sql
 * con los comandos SQL para ejecutar manualmente.
 */

require('dotenv').config();
const { Sequelize } = require('sequelize');

const env = process.env.NODE_ENV || 'production';
const config = {
  production: {
    username: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    dialect: 'postgres',
    logging: false,
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false
      }
    }
  }
}[env];

const sequelize = new Sequelize(
  config.database,
  config.username,
  config.password,
  {
    host: config.host,
    port: config.port,
    dialect: config.dialect,
    logging: false,
    dialectOptions: config.dialectOptions
  }
);

async function generateCleanupSQL() {
  console.log('🔍 Analizando índices duplicados...\n');

  try {
    await sequelize.authenticate();
    console.log('✅ Conectado a la base de datos\n');

    // Buscar índices duplicados en Users
    const [usersIndexes] = await sequelize.query(`
      SELECT indexname 
      FROM pg_indexes 
      WHERE tablename = 'users' 
      AND indexname LIKE 'users_email_key%'
      ORDER BY indexname
    `);

    // Buscar índices duplicados en Businesses
    const [businessesIndexes] = await sequelize.query(`
      SELECT indexname 
      FROM pg_indexes 
      WHERE tablename = 'businesses' 
      AND indexname LIKE 'businesses_slug_key%'
      ORDER BY indexname
    `);

    console.log(`📊 Encontrados ${usersIndexes.length} índices en Users`);
    console.log(`📊 Encontrados ${businessesIndexes.length} índices en Businesses\n`);

    // Filtrar para mantener solo el índice original (sin número)
    const usersDuplicates = usersIndexes
      .filter(idx => idx.indexname !== 'users_email_key')
      .map(idx => idx.indexname);

    const businessesDuplicates = businessesIndexes
      .filter(idx => idx.indexname !== 'businesses_slug_key')
      .map(idx => idx.indexname);

    console.log(`🗑️  ${usersDuplicates.length} índices duplicados en Users`);
    console.log(`🗑️  ${businessesDuplicates.length} índices duplicados en Businesses\n`);

    // Generar SQL
    let sql = '-- Script generado automáticamente para limpiar índices duplicados\n';
    sql += '-- Ejecutar con: psql -U ' + config.username + ' -d ' + config.database + ' -f cleanup-duplicate-indexes-generated.sql\n\n';
    sql += '-- ⚠️  BACKUP ANTES DE EJECUTAR ESTE SCRIPT\n';
    sql += '-- pg_dump -U ' + config.username + ' -d ' + config.database + ' > backup_before_cleanup.sql\n\n';

    sql += '-- ============================================\n';
    sql += '-- LIMPIEZA DE ÍNDICES DUPLICADOS EN USERS\n';
    sql += '-- ============================================\n\n';

    sql += '-- Paso 1: Eliminar constraints asociadas a índices duplicados\n';
    for (const indexName of usersDuplicates) {
      sql += `ALTER TABLE "Users" DROP CONSTRAINT IF EXISTS "${indexName}";\n`;
    }
    sql += '\n';

    sql += '-- Paso 2: Eliminar índices huérfanos\n';
    for (const indexName of usersDuplicates) {
      sql += `DROP INDEX IF EXISTS "${indexName}";\n`;
    }
    sql += '\n';

    sql += '-- ============================================\n';
    sql += '-- LIMPIEZA DE ÍNDICES DUPLICADOS EN BUSINESSES\n';
    sql += '-- ============================================\n\n';

    sql += '-- Paso 3: Eliminar constraints asociadas a índices duplicados\n';
    for (const indexName of businessesDuplicates) {
      sql += `ALTER TABLE "Businesses" DROP CONSTRAINT IF EXISTS "${indexName}";\n`;
    }
    sql += '\n';

    sql += '-- Paso 4: Eliminar índices huérfanos\n';
    for (const indexName of businessesDuplicates) {
      sql += `DROP INDEX IF EXISTS "${indexName}";\n`;
    }
    sql += '\n';

    sql += '-- ============================================\n';
    sql += '-- VERIFICACIÓN\n';
    sql += '-- ============================================\n\n';
    sql += '-- Verificar índices restantes en Users\n';
    sql += 'SELECT indexname FROM pg_indexes WHERE tablename = \'users\' AND indexname LIKE \'users_email_key%\' ORDER BY indexname;\n\n';
    sql += '-- Verificar índices restantes en Businesses\n';
    sql += 'SELECT indexname FROM pg_indexes WHERE tablename = \'businesses\' AND indexname LIKE \'businesses_slug_key%\' ORDER BY indexname;\n';

    // Guardar archivo SQL
    const fs = require('fs');
    fs.writeFileSync('cleanup-duplicate-indexes-generated.sql', sql);

    console.log('✅ Archivo SQL generado: cleanup-duplicate-indexes-generated.sql');
    console.log('\n📋 Pasos para ejecutar la limpieza:\n');
    console.log('1. Hacer backup de la base de datos:');
    console.log(`   pg_dump -U ${config.username} -d ${config.database} > backup_before_cleanup.sql\n`);
    console.log('2. Revisar el archivo generado:');
    console.log('   cat cleanup-duplicate-indexes-generated.sql\n');
    console.log('3. Ejecutar el script SQL:');
    console.log(`   psql -U ${config.username} -d ${config.database} -f cleanup-duplicate-indexes-generated.sql\n`);
    console.log('4. Verificar que la aplicación funcione correctamente después de la limpieza\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

generateCleanupSQL();
