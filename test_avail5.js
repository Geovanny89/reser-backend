const { Business, Employee, Service, Schedule, SpecialSchedule, Appointment } = require('./src/models');
const { Op } = require('sequelize');
const { colombiaDateFromString, getDayOfWeekColombia } = require('./src/controllers/appointment/utils');
const { getAvailability } = require('./src/controllers/appointment/availability');

async function test() {
  try {
    const business = await Business.findOne();
    const employee = await Employee.findOne({ where: { businessId: business.id } });
    const service = await Service.findOne({ where: { businessId: business.id } });

    console.log(`Testing with Business: ${business.id}, Employee: ${employee.id}, Service: ${service.id}`);

    // Create a special schedule to block 08:00 to 11:00 for tomorrow
    const tomorrowDate = new Date();
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const dateStr = tomorrowDate.toISOString().split('T')[0];

    const dayOfWeek = tomorrowDate.getDay() === 0 ? 7 : tomorrowDate.getDay();

    await Schedule.destroy({ where: { employeeId: employee.id, dayOfWeek } });
    await Schedule.create({
      businessId: business.id,
      employeeId: employee.id,
      dayOfWeek,
      type: 'work',
      startTime: '08:00',
      endTime: '17:00',
      active: true
    });

    await SpecialSchedule.destroy({ where: { employeeId: employee.id, specificDate: dateStr } });
    await SpecialSchedule.create({
      businessId: business.id,
      employeeId: employee.id,
      type: 'blocked',
      specificDate: dateStr,
      startTime: '08:00',
      endTime: '11:00',
      active: true,
      isRecurringYearly: false
    });

    const availability = require('./src/controllers/appointment/availability');
    // I'll patch the generateAvailableSlots method temporarily
    const originalGenerate = availability.generateAvailableSlots;
    
    // I'll just run getAvailability normally, but with Sequelize query logging enabled for debugging
    const res = await getAvailability(dateStr, employee.id, service.id, business.id, true);
    console.log("AVAILABLE SLOTS", JSON.stringify(res.availableSlots, null, 2));

    await SpecialSchedule.destroy({ where: { employeeId: employee.id, specificDate: dateStr } });
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

test();
