const { Business, Service, Employee, User } = require('./src/models');

async function getTestIds() {
  try {
    console.log('Buscando combinaciones válidas en la base de datos...');
    
    // 1. Encontrar cualquier negocio
    const business = await Business.findOne();
    if (!business) {
      console.log('Error: No encontré ningún negocio.');
      process.exit(0);
    }

    // 2. Encontrar un servicio de ese negocio
    const service = await Service.findOne({ where: { businessId: business.id } });
    if (!service) {
       console.log(`Error: El negocio ${business.name} no tiene servicios creados.`);
       process.exit(0);
    }

    // 3. Encontrar un empleado de ese negocio (Employee model)
    const employee = await Employee.findOne({ 
      where: { businessId: business.id },
      include: [{ model: User }]
    });
    
    if (!employee) {
       console.log(`Error: El negocio ${business.name} no tiene empleados vinculados en la tabla Employee.`);
       process.exit(0);
    }

    console.log('\n=============================================');
    console.log('   ✅ IDS VÁLIDOS ENCONTRADOS PARA EL TEST   ');
    console.log('=============================================');
    console.log(`Negocio: ${business.name}`);
    console.log(`Servicio: ${service.name}`);
    console.log(`Empleado: ${employee.User ? employee.User.name : 'Sin Nombre'} (ID Empleado: ${employee.id})`);
    console.log('\nCopia y pega exactamente esto en variables de tu stress-client.yml:\n');
    console.log(`  variables:`);
    console.log(`    businessId: "${business.id}"`);
    console.log(`    serviceId: "${service.id}"`);
    console.log(`    employeeId: "${employee.id}"`);
    console.log('=============================================\n');

  } catch (error) {
    console.error('Error al buscar la base de datos:', error);
  } finally {
    process.exit(0);
  }
}

getTestIds();
