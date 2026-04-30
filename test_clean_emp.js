const { Business, Employee, Service, Schedule, SpecialSchedule, Appointment } = require('./src/models');
const { getAvailability } = require('./src/controllers/appointment/availability');

async function test() {
  const empId = '2cd43c3d-cdcf-421e-915a-35bee251014f';
  const bizId = '4c8daef6-85fa-413b-b4ef-ca08567c4b7b';
  const svcId = '1996f1d2-29f6-4d07-b1ea-a60ad32209e4';
  const dateStr = '2026-04-30';

  try {
    // 1. Regular schedule
    await Schedule.destroy({ where: { employeeId: empId, dayOfWeek: 4 } });
    await Schedule.create({
      businessId: bizId,
      employeeId: empId,
      dayOfWeek: 4,
      startTime: '08:00',
      endTime: '17:00',
      type: 'work',
      active: true
    });

    // 2. Special schedule
    await SpecialSchedule.destroy({ where: { employeeId: empId, specificDate: dateStr } });
    await SpecialSchedule.create({
      businessId: bizId,
      employeeId: empId,
      specificDate: dateStr,
      startTime: '08:00',
      endTime: '09:00',
      type: 'blocked',
      active: true
    });

    // 3. Test
    const res = await getAvailability(dateStr, empId, svcId, bizId, true);
    console.log('--- TEST EMP CON PERMISO ---');
    console.log('Slots count:', res.availableSlots.length);
    if (res.availableSlots.length > 0) {
      console.log('Primeros 5 slots:', res.availableSlots.slice(0, 5).map(s => s.time));
    }

    // Cleanup
    await SpecialSchedule.destroy({ where: { employeeId: empId, specificDate: dateStr } });
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

test();
