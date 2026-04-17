/**
 * Migración: Agregar columnas de calificación a Employee
 * Ejecutar: node src/migrations/add_employee_rating_columns.js
 */

const { sequelize } = require('../models');

async function migrate() {
  try {
    console.log('[Migración] Agregando columnas de calificación a Employee...');
    
    // Verificar si las columnas existen
    const [columns] = await sequelize.query(
      "PRAGMA table_info(Employees)"
    );
    
    const hasAverageRating = columns.some(col => col.name === 'averageRating');
    const hasTotalReviews = columns.some(col => col.name === 'totalReviews');
    
    if (hasAverageRating && hasTotalReviews) {
      console.log('[Migración] Las columnas ya existen. No se requiere migración.');
      process.exit(0);
    }
    
    // Agregar columnas
    if (!hasAverageRating) {
      await sequelize.query(
        "ALTER TABLE Employees ADD COLUMN averageRating DECIMAL(3,2) DEFAULT 0"
      );
      console.log('[Migración] ✅ Columna averageRating agregada');
    }
    
    if (!hasTotalReviews) {
      await sequelize.query(
        "ALTER TABLE Employees ADD COLUMN totalReviews INTEGER DEFAULT 0"
      );
      console.log('[Migración] ✅ Columna totalReviews agregada');
    }
    
    console.log('[Migración] ✅ Migración completada exitosamente');
    process.exit(0);
  } catch (error) {
    console.error('[Migración] ❌ Error:', error.message);
    process.exit(1);
  }
}

migrate();
