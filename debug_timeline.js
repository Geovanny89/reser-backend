const { Appointment, SpecialSchedule, Schedule } = require('./src/models');
const { Op } = require('sequelize');
const { getAvailability } = require('./src/controllers/appointment/availability');

async function debug() {
  const dateStr = '2026-04-30';
  const empId = '17f7a6c6-07c3-4d3a-886c-1ab3eb9a447c';
  const bizId = '4c8daef6-85fa-413b-b4ef-ca08567c4b7b';
  const svcId = '1996f1d2-29f6-4d07-b1ea-a60ad32209e4';

  const startOfDay = new Date(`${dateStr}T00:00:00-05:00`);
  const endOfDay = new Date(`${dateStr}T23:59:59-05:00`);

  const appts = await Appointment.findAll({
    where: {
      employeeId: empId,
      startTime: { [Op.lt]: endOfDay },
      endTime: { [Op.gt]: startOfDay },
      status: { [Op.not]: 'cancelled' }
    }
  });

  const special = await SpecialSchedule.findAll({
    where: { employeeId: empId, specificDate: dateStr }
  });

  const regular = await Schedule.findAll({
    where: { employeeId: empId, dayOfWeek: 4, active: true }
  });

  console.log('--- REGLAS DEL DÍA ---');
  regular.forEach(r => console.log(`Regular: ${r.type} ${r.startTime} - ${r.endTime}`));
  special.forEach(s => console.log(`Especial: ${s.type} ${s.startTime} - ${s.endTime}`));
  
  console.log('--- CITAS ---');
  const toColStr = (d) => new Date(d).toLocaleTimeString('es-CO', {timeZone: 'America/Bogota', hour12: false});
  appts.sort((a,b) => new Date(a.startTime) - new Date(b.startTime)).forEach(a => {
    console.log(`Cita: ${toColStr(a.startTime)} - ${toColStr(a.endTime)} (${a.clientName})`);
  });

  const res = await getAvailability(dateStr, empId, svcId, bizId, true);
  console.log('--- RESULTADO ---');
  console.log('Slots disponibles:', res.availableSlots.length);
  process.exit(0);
}

debug();
