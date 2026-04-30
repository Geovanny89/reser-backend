const { Business, Employee, Service, Schedule, SpecialSchedule, Appointment } = require('./src/models');
const { Op } = require('sequelize');
const { getAvailability } = require('./src/controllers/appointment/availability');

async function test() {
  const dateStr = '2026-04-30';
  const employeeId = '17f7a6c6-07c3-4d3a-886c-1ab3eb9a447c';
  const serviceId = '6aac8f78-870e-4c4d-a06a-5c3c9e76949a';
  const businessId = '4c8daef6-85fa-413b-b4ef-ca08567c4b7b';

  const availability = require('./src/controllers/appointment/availability');
  const ogGet = availability.getAvailability;

  // run ogGet and trace its variables
  try {
    const res = await ogGet(dateStr, employeeId, serviceId, businessId, true);
    console.log(JSON.stringify(res, null, 2));
  } catch (err) {
    console.error(err);
  }
}

test();
