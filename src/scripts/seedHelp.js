const { HelpArticle } = require('../models');

const initialArticles = [
  {
    title: 'Cómo crear una cita',
    category: 'citas',
    keywords: 'crear cita, nueva reserva, agendar, turno, appointment, calendario',
    content: 'Para crear una cita:\n1. Ve a **Agenda** o **Citas**.\n2. Haz clic en **+ Nueva Cita**.\n3. Selecciona el Cliente (o crea uno nuevo), el Servicio y el Profesional.\n4. Elige la fecha y hora.\n5. Haz clic en **Guardar**.\n\n*Tip: También puedes hacer clic directamente en un espacio vacío del calendario.*',
    role: 'admin',
    order: 1
  },
  {
    title: 'Cómo agregar un profesional (Empleado)',
    category: 'profesionales',
    keywords: 'crear profesional, nuevo empleado, barbero, estilista, equipo, employee, horario, disponibilidad',
    content: 'Para agregar personal:\n1. Ve a **Configuración > Profesionales**.\n2. Haz clic en **Agregar Profesional**.\n3. Ingresa sus datos básicos y el % de comisión que gana.\n4. Selecciona qué servicios puede realizar.\n5. Configura sus **Horarios** de atención para que aparezca disponible en la agenda.',
    role: 'admin',
    order: 2
  },
  {
    title: 'Apertura de Caja (Iniciar Turno)',
    category: 'finanzas',
    keywords: 'abrir caja, iniciar caja, apertura caja, turno de caja, saldo inicial, base de caja, cash register',
    content: 'Para comenzar a registrar transacciones en el día:\n1. Ve al módulo **Caja**.\n2. Si no hay un turno activo, el sistema te solicitará abrir la caja.\n3. Ingresa el **Monto de Apertura** (el dinero base en efectivo para dar cambio).\n4. Puedes seleccionar el profesional encargado y añadir notas aclaratorias.\n5. Haz clic en **Abrir Caja**.\n\n*Nota: La apertura de caja es obligatoria para poder procesar pagos en efectivo o registrar gastos en el turno actual.*',
    role: 'admin',
    order: 3
  },
  {
    title: 'Cierre de Caja Diario',
    category: 'finanzas',
    keywords: 'cerrar caja, turno, balance, dinero, efectivo, cash register, balance diario',
    content: 'El cierre de caja asegura que tus cuentas cuadren:\n1. Ve al módulo **Caja**.\n2. Haz clic en **Cerrar Turno**.\n3. El sistema mostrará el total esperado (ventas - gastos).\n4. Ingresa el monto real que tienes en efectivo.\n5. Guarda el cierre para generar el reporte histórico.',
    role: 'admin',
    order: 4
  },
  {
    title: '¿Por qué la sección de Pagos no muestra información?',
    category: 'finanzas',
    keywords: 'pagos, comisiones, no muestra, sin datos, vacio, reporte de pagos, ganancias, profesional, error pagos',
    content: 'Si la sección de Pagos y Comisiones aparece vacía o con un mensaje informativo, ten en cuenta lo siguiente:\n1. **Citas Completadas**: El reporte solo calcula comisiones a partir de citas con estado **Completada (done)**. Las citas pendientes o confirmadas no generan comisiones.\n2. **Rango de Fechas**: Selecciona el período correcto (Mes actual o Rango de fechas personalizado) y asegúrate de hacer clic en el botón **Filtrar**.\n3. **Modo de Negocio**: Si tu negocio está configurado como **Servicios Técnicos** o **Técnicos a Domicilio**, las comisiones monetarias están desactivadas. En este modo el sistema hace seguimiento por cantidad de citas atendidas, no por ingresos. Puedes cambiar esto en **Mi Negocio > Módulos** desactivando el modo de servicios técnicos.\n4. **Asignación de Comisiones**: Verifica en **Profesionales** que tus empleados tengan un porcentaje de comisión configurado mayor a 0%.',
    role: 'admin',
    order: 5
  },
  {
    title: 'Control de Gastos',
    category: 'finanzas',
    keywords: 'gastos, egresos, pagar, servicios, arriendo, expenses, fijos, insumos',
    content: 'Registra tus gastos para mantener un balance real de tu utilidad:\n1. Ve a **Finanzas > Gastos** o **Gastos**.\n2. Haz clic en **Nuevo Gasto**.\n3. Ingresa el monto, descripción y selecciona una categoría:\n   - **General / Variable**: Gastos ocasionales.\n   - **Fijo**: Gastos mensuales recurrentes (ej: arriendo, servicios).\n   - **Insumos / Suministros**: Productos consumidos en los servicios (afecta el cálculo de comisiones deducibles).\n4. Elige el **Método de Pago**: Si seleccionas \'Efectivo (Caja Chica)\', se restará automáticamente del dinero de la caja del turno activo.\n5. Los gastos se restan del ingreso bruto para mostrar tu ganancia neta en los reportes financieros.',
    role: 'admin',
    order: 6
  },
  {
    title: 'Gestión de Inventario (Insumos)',
    category: 'inventario',
    keywords: 'inventario, insumos, productos, stock, suministros, inventory',
    content: 'Para controlar tus productos de uso interno:\n1. Ve a **Finanzas > Insumos** o **Inventario**.\n2. Crea tus productos indicando el stock actual y el costo.\n3. Al crear una cita, puedes asignar el consumo de estos insumos para descontarlos automáticamente del stock y calcular el costo del servicio.',
    role: 'admin',
    order: 7
  },
  {
    title: 'Conectar WhatsApp (Evolution)',
    category: 'configuracion',
    keywords: 'whatsapp, conectar, qr, mensajes, notificaciones, evolution',
    content: 'Para enviar recordatorios por WhatsApp:\n1. En el **Dashboard**, verás el widget de WhatsApp.\n2. Si no está conectado, haz clic en **Generar QR**.\n3. Escanea el código desde tu teléfono (WhatsApp > Dispositivos vinculados).\n4. Una vez conectado, los recordatorios se enviarán automáticamente 1 hora antes de cada cita.',
    role: 'admin',
    order: 8
  },
  {
    title: 'Reportes y Estadísticas',
    category: 'informes',
    keywords: 'reportes, ventas, estadisticas, exportar excel, dashboard, reports',
    content: 'Para analizar tu negocio:\n1. El **Dashboard** te da un resumen rápido de hoy.\n2. En **Informes**, puedes filtrar por fechas para ver ventas totales, servicios más pedidos y desempeño de profesionales.\n3. Puedes exportar un **Excel Detallado** con todos los movimientos financieros para tu contabilidad.',
    role: 'admin',
    order: 9
  },
  {
    title: 'Programa de Referidos',
    category: 'marketing',
    keywords: 'referidos, ganar, descuento, recomendar, puntos',
    content: 'Haz que tus clientes traigan a otros:\n1. Ve a **Configuración > Programa de Referidos**.\n2. Configura cuántos puntos o qué beneficio gana un cliente por cada persona recomendada que complete una cita.\n3. El sistema rastreará automáticamente quién recomendó a quién mediante el teléfono del cliente.',
    role: 'admin',
    order: 10
  },
  {
    title: 'Configurar Horarios de Atención',
    category: 'configuracion',
    keywords: 'horario, apertura, cierre, jornada, disponible, horas',
    content: 'Para configurar los horarios de tu negocio o profesionales:\n1. Ve a **Configuración > Horarios**.\n2. Aquí puedes definir la jornada laboral general del negocio.\n3. Si quieres configurar el horario de un profesional específico, ve a la ficha del profesional y entra en la pestaña **Horarios**.\n4. Recuerda que si un profesional no tiene horario asignado, no aparecerá disponible para citas.',
    role: 'admin',
    order: 11
  },
  {
    title: 'Cómo configurar Mi Negocio',
    category: 'configuracion',
    keywords: 'mi negocio, configurar, personalizar, logo, banner, sucursales, modulos, metodos de pago',
    content: 'Personaliza tu negocio y el portal público desde **Mi Negocio**:\n1. **Información**: Nombre, descripción, teléfono y dirección física.\n2. **Sucursales**: Registra y administra sedes adicionales de tu negocio.\n3. **Media**: Sube el logotipo y la imagen de banner de tu negocio.\n4. **Galería**: Muestra un portafolio de fotos de tus trabajos en la landing page.\n5. **Redes Sociales**: Enlaza tus redes y conecta tu número de WhatsApp para Evolution API.\n6. **Métodos de Pago**: Configura transferencia (Nequi, Daviplata, banco) y permite que los clientes suban capturas de pantalla de sus transferencias.\n7. **Misión y Visión**: Describe la identidad de tu empresa.\n8. **Diseño**: Cambia la paleta de colores y gradientes de tu portal público.\n9. **Horarios**: Jornada general de atención de la empresa.\n10. **Módulos**: Activa o desactiva funciones como anticipos obligatorios (depósitos), notificaciones por WhatsApp o el modo de servicios técnicos.',
    role: 'admin',
    order: 12
  },
  {
    title: 'Vacaciones, Festivos y Bloqueos de Agenda',
    category: 'configuracion',
    keywords: 'vacaciones, festivos, bloqueos, descanso, especial, no disponible, inactivo, horario especial',
    content: 'Evita reservas en días de descanso o feriados con estas herramientas:\n1. **Vacaciones del Personal**: Ve a **Configuración > Empleados**, selecciona la pestaña **Vacaciones** de un empleado y registra el rango de fechas. El profesional no estará disponible para agendar durante ese lapso.\n2. **Horarios Especiales y Bloqueos**: Ve a **Configuración > Horarios Especiales**. Registra excepciones a la jornada habitual:\n   - **Bloqueo de horas**: Agenda un bloqueo para un empleado (ej: almuerzo o cita personal) desde la Agenda de citas.\n   - **Días Festivos/Cierres**: Crea un Horario Especial marcando el día completo como no laborable para todo el negocio o para un profesional en particular.\n3. Estas excepciones actualizan la agenda en tiempo real, impidiendo que los clientes reserven en la página pública durante esos horarios.',
    role: 'admin',
    order: 13
  }
];

async function seedHelpArticles() {
  try {
    console.log('🌱 Sembrando/Actualizando artículos de ayuda...');
    for (const art of initialArticles) {
      const existing = await HelpArticle.findOne({ where: { title: art.title } });
      if (existing) {
        await existing.update(art);
        console.log(`✅ Actualizado: ${art.title}`);
      } else {
        await HelpArticle.create(art);
        console.log(`✨ Creado: ${art.title}`);
      }
    }
    console.log('🚀 Semilla de ayuda completada.');
  } catch (error) {
    console.error('❌ Error sembrando ayuda:', error);
  }
}

module.exports = seedHelpArticles;
