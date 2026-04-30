const { getAvailability } = require('./src/controllers/appointment/availability');

async function test() {
  try {
    const res = await getAvailability('2026-04-30', 'd7cdba69-ca3b-4876-ae38-34863fba01cc', '8c41f71a-281b-410a-b3ff-674cd7384a32', '3157b856-78cc-4d3f-ad0d-456cb04cbb68', true);
    console.log(JSON.stringify(res, null, 2));
  } catch (err) {
    console.error(err);
  }
}

test();
