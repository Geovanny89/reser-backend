module.exports = {
  generateFakeAppointmentData
};

let globalSlotCounter = 0;

function generateFakeAppointmentData(requestParams, context, ee, next) {
  // Generar teléfono falso de 10 dígitos
  const fakePhone = "300" + Math.floor(1000000 + Math.random() * 9000000).toString();
  
  // Nombres aleatorios
  const names = ["Ana", "Carlos", "Maria", "Juan", "Laura", "Pedro", "Sofia", "Diego", "Luis", "Elena"];
  const randomName = names[Math.floor(Math.random() * names.length)] + " " + (Math.floor(Math.random() * 1000));
  
  // Crear una fecha base (mañana a las 8 AM)
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + 1);
  targetDate.setHours(8, 0, 0, 0);
  
  // Sumar 1 hora por cada petición para garantizar que NINGUNA cita choque
  targetDate.setHours(targetDate.getHours() + globalSlotCounter);
  globalSlotCounter++;

  context.vars.fakePhone = fakePhone;
  context.vars.fakeName = randomName;
  context.vars.fakeStartTime = targetDate.toISOString();
  
  return next();
}
