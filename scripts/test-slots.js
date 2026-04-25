/**
 * Script para probar generación de slots
 * Simula la lógica de availability.js
 */

const { sequelize } = require('../src/models');

async function testSlots() {
  try {
    await sequelize.authenticate();
    console.log('✓ Conectado a la base de datos\n');

    const { Schedule, Service } = require('../src/models');

    const employeeId = 'fba841ad-c10b-480d-b23d-ee97bfffefd1';
    const date = '2026-04-23'; // Jueves (dayOfWeek = 4)
    const dayOfWeek = 4;

    // Obtener horarios del empleado para ese día
    const schedules = await Schedule.findAll({
      where: { employeeId, dayOfWeek, active: true }
    });

    console.log('=== HORARIOS CONFIGURADOS ===');
    schedules.forEach(s => {
      console.log(`Tipo: ${s.type.padEnd(8)} | ${s.startTime} - ${s.endTime}`);
    });
    console.log('');

    // Obtener servicios del negocio
    const services = await Service.findAll({
      where: { businessId: 'ec5dd021-f681-424b-aa5f-1685d5e8d986', active: true }
    });

    console.log('=== SERVICIOS DEL NEGOCIO ===');
    services.forEach(s => {
      console.log(`${s.name.substring(0, 40).padEnd(40)} | Duración: ${s.durationMin} min | Precio: $${s.price}`);
    });
    console.log('');

    // Simular generación de slots para cada servicio
    const toMinutes = (timeStr) => {
      const [h, m] = timeStr.split(':').map(Number);
      return h * 60 + m;
    };

    const workSchedules = schedules.filter(s => {
      const type = (s.type || 'work').trim().toLowerCase();
      return type === 'work';
    });

    const lunchRanges = schedules.filter(s => (s.type || '').trim().toLowerCase() === 'lunch');

    console.log('=== SIMULACIÓN DE SLOTS GENERADOS ===\n');

    for (const service of services) {
      const duration = service.durationMin || 30;
      console.log(`--- Servicio: ${service.name} (${duration} min) ---`);

      for (const sched of workSchedules) {
        const workStart = toMinutes(sched.startTime);
        const workEnd = toMinutes(sched.endTime);
        let current = workStart;
        const slots = [];

        while (current + duration <= workEnd) {
          const hh = String(Math.floor(current / 60)).padStart(2, '0');
          const mm = String(current % 60).padStart(2, '0');
          const timeStr = `${hh}:${mm}`;

          // Verificar almuerzo
          const conflictLunch = lunchRanges.find(r => {
            const lunchStart = toMinutes(r.startTime);
            const lunchEnd = toMinutes(r.endTime);
            return current < lunchEnd && current + duration > lunchStart;
          });

          if (conflictLunch) {
            const lunchEnd = toMinutes(conflictLunch.endTime);
            if (lunchEnd >= workEnd) break;
            current = lunchEnd;
            continue;
          }

          slots.push(timeStr);
          current += duration;
        }

        console.log(`  Horario ${sched.startTime}-${sched.endTime}: ${slots.length} slots`);
        if (slots.length > 0) {
          console.log(`  Slots: ${slots.slice(0, 10).join(', ')}${slots.length > 10 ? '...' : ''}`);
          console.log(`  Último slot: ${slots[slots.length - 1]}`);
        }
      }
      console.log('');
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await sequelize.close();
  }
}

testSlots();
