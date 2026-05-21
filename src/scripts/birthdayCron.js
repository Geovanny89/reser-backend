const { ClientProfile, BirthdayTemplate, Business, WhatsAppSession, Appointment, Op } = require('../models');
const { scheduleMessage } = require('../services/schedulerService');

/**
 * Tarea diaria para procesar cumpleaños
 */
async function processBirthdays() {
    const now = new Date();
    const colombiaOffset = -5 * 60 * 60 * 1000;
    const colombiaTime = new Date(now.getTime() + colombiaOffset);

    const currentMonth = colombiaTime.getUTCMonth() + 1;
    const currentDay = colombiaTime.getUTCDate();
    const currentYear = colombiaTime.getUTCFullYear();

    console.log(`[Birthday Cron] 🎂 Procesando cumpleaños para ${currentDay}/${currentMonth}/${currentYear}`);

    try {
        // 1. Buscar todos los perfiles que cumplen años hoy
        // Nota: Como birthday es DATEONLY (YYYY-MM-DD), buscamos los que coincidan en mes y día
        const profiles = await ClientProfile.findAll({
            where: {
                birthday: { [Op.not]: null },
                lastSentBirthdayYear: { [Op.or]: [{ [Op.ne]: currentYear }, { [Op.is]: null }] }
            }
        });

        // Filtrar manualmente por mes y día para ser agnóstico a la base de datos (Postgres/MySQL/SQLite)
        const birthdayProfiles = profiles.filter(p => {
            const b = new Date(p.birthday);
            return (b.getUTCMonth() + 1) === currentMonth && b.getUTCDate() === currentDay;
        });

        console.log(`[Birthday Cron] 🎂 Se encontraron ${birthdayProfiles.length} cumpleañeros para hoy`);

        // Agrupar por negocio para rotar plantillas correctamente
        const groupedByBusiness = {};
        birthdayProfiles.forEach(p => {
            if (!groupedByBusiness[p.businessId]) groupedByBusiness[p.businessId] = [];
            groupedByBusiness[p.businessId].push(p);
        });

        for (const [businessId, profiles] of Object.entries(groupedByBusiness)) {
            try {
                // 2. Obtener plantillas activas del negocio
                const templates = await BirthdayTemplate.findAll({
                    where: { businessId, isActive: true },
                    order: [['createdAt', 'ASC']]
                });

                if (templates.length === 0) {
                    console.log(`[Birthday Cron] ⚠️ Negocio ${businessId} no tiene plantillas activas. Saltando.`);
                    continue;
                }

                const { getRandomTemplate } = require('../services/reminder/message.generators');

                for (let i = 0; i < profiles.length; i++) {
                    const profile = profiles[i];
                    try {
                        // 3. Seleccionar una plantilla por rotación (i % templates.length)
                        // Esto asegura que se usen todas las plantillas disponibles de forma equitativa
                        const selectedTemplate = templates[i % templates.length].content;
                        let finalMessage = getRandomTemplate([selectedTemplate]);

                        // 3.1 Buscar el nombre del cliente en su última cita
                        const lastApt = await Appointment.findOne({
                            where: {
                                businessId: profile.businessId,
                                clientPhone: profile.clientPhone
                            },
                            order: [['startTime', 'DESC']]
                        });

                        const clientName = lastApt ? lastApt.clientName : '';

                        // 3.2 Reemplazar variables o añadir nombre al principio si no está la etiqueta
                        if (clientName) {
                            if (finalMessage.includes('{{name}}')) {
                                finalMessage = finalMessage.replace(/{{name}}/g, clientName);
                            } else {
                                finalMessage = `¡Hola *${clientName.trim()}*! ${finalMessage}`;
                            }
                        }

                        // 4. Programar el mensaje
                        const phone = profile.clientPhone;
                        if (!phone) continue;

                        await scheduleMessage({
                            businessId: profile.businessId,
                            phone,
                            message: finalMessage,
                            type: 'birthday',
                            scheduledAt: new Date()
                        });

                        // 5. Marcar como enviado este año
                        await profile.update({ lastSentBirthdayYear: currentYear });

                        console.log(`[Birthday Cron] ✅ Cumpleaños programado para ${phone} (Negocio: ${profile.businessId}) - Plantilla ${(i % templates.length) + 1}`);

                    } catch (err) {
                        console.error(`[Birthday Cron] ❌ Error procesando perfil ${profile.id}:`, err.message);
                    }
                }
            } catch (err) {
                console.error(`[Birthday Cron] ❌ Error procesando negocio ${businessId}:`, err.message);
            }
        }

    } catch (error) {
        console.error('[Birthday Cron] ❌ Error crítico:', error.message);
    }
}

module.exports = { processBirthdays };