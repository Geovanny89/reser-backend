-- Crear tabla AppointmentEmployees para citas grupales
CREATE TABLE IF NOT EXISTS "AppointmentEmployees" (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    "appointmentId" UUID NOT NULL REFERENCES "Appointments"(id) ON DELETE CASCADE,
    "employeeId" UUID NOT NULL REFERENCES "Employees"(id) ON DELETE CASCADE,
    role VARCHAR(255),
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE("appointmentId", "employeeId")
);

-- Índices para búsquedas rápidas
CREATE INDEX IF NOT EXISTS idx_appointment_employee_employeeid ON "AppointmentEmployees"("employeeId");

-- Verificar que se creó
SELECT 'Tabla AppointmentEmployees creada correctamente' as status;
