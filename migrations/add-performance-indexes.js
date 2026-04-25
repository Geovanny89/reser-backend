/**
 * Migración para agregar índices de rendimiento
 * Estos índices mejoran significativamente la velocidad de las consultas más frecuentes
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    console.log('Agregando índices de rendimiento...');

    // Índices para Appointments - las consultas más críticas
    await queryInterface.addIndex('Appointments', ['businessId'], {
      name: 'idx_appointments_business_id'
    });
    await queryInterface.addIndex('Appointments', ['employeeId'], {
      name: 'idx_appointments_employee_id'
    });
    await queryInterface.addIndex('Appointments', ['clientId'], {
      name: 'idx_appointments_client_id'
    });
    await queryInterface.addIndex('Appointments', ['status'], {
      name: 'idx_appointments_status'
    });
    await queryInterface.addIndex('Appointments', ['startTime'], {
      name: 'idx_appointments_start_time'
    });
    // Índice compuesto para consultas por negocio y fecha (muy común)
    await queryInterface.addIndex('Appointments', ['businessId', 'startTime'], {
      name: 'idx_appointments_business_start'
    });
    // Índice compuesto para consultas por empleado y fecha
    await queryInterface.addIndex('Appointments', ['employeeId', 'startTime'], {
      name: 'idx_appointments_employee_start'
    });

    // Índices para Business
    await queryInterface.addIndex('Businesses', ['slug'], {
      name: 'idx_businesses_slug',
      unique: true
    });
    await queryInterface.addIndex('Businesses', ['ownerId'], {
      name: 'idx_businesses_owner_id'
    });
    await queryInterface.addIndex('Businesses', ['parentBusinessId'], {
      name: 'idx_businesses_parent_id'
    });

    // Índices para Employees
    await queryInterface.addIndex('Employees', ['businessId'], {
      name: 'idx_employees_business_id'
    });
    await queryInterface.addIndex('Employees', ['userId'], {
      name: 'idx_employees_user_id'
    });

    // Índices para Services
    await queryInterface.addIndex('Services', ['businessId'], {
      name: 'idx_services_business_id'
    });
    await queryInterface.addIndex('Services', ['serviceGroupId'], {
      name: 'idx_services_group_id'
    });

    // Índices para Users
    await queryInterface.addIndex('Users', ['email'], {
      name: 'idx_users_email'
    });

    // Índices para Promotions
    await queryInterface.addIndex('Promotions', ['businessId'], {
      name: 'idx_promotions_business_id'
    });

    // Índices para Reviews
    await queryInterface.addIndex('BusinessReviews', ['businessId'], {
      name: 'idx_reviews_business_id'
    });
    await queryInterface.addIndex('BusinessReviews', ['isApproved'], {
      name: 'idx_reviews_approved'
    });

    console.log('Índices agregados exitosamente');
  },

  down: async (queryInterface, Sequelize) => {
    // Eliminar todos los índices en caso de rollback
    const indexes = [
      'idx_appointments_business_id',
      'idx_appointments_employee_id',
      'idx_appointments_client_id',
      'idx_appointments_status',
      'idx_appointments_start_time',
      'idx_appointments_business_start',
      'idx_appointments_employee_start',
      'idx_businesses_slug',
      'idx_businesses_owner_id',
      'idx_businesses_parent_id',
      'idx_employees_business_id',
      'idx_employees_user_id',
      'idx_services_business_id',
      'idx_services_group_id',
      'idx_users_email',
      'idx_promotions_business_id',
      'idx_reviews_business_id',
      'idx_reviews_approved'
    ];

    for (const index of indexes) {
      try {
        await queryInterface.removeIndex('Appointments', index);
      } catch (e) {
        // Ignorar si el índice no existe
      }
    }
  }
};
