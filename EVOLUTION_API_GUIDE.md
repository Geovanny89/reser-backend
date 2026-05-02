# Guía de Integración con Evolution API

## ¿Qué es Evolution API?

Evolution API es una alternativa más estable a `whatsapp-web.js` que:
- No requiere Chrome/Puppeteer (menor consumo de memoria)
- Maneja reconexiones automáticamente
- Es más escalable y estable para producción
- Corre como servicio Docker independiente

## Estado Actual

**Tu sistema sigue funcionando exactamente igual**. Evolution API está implementado pero **NO ACTIVO** por defecto.

## Cómo Activar Evolution API

### 1. Instalar Evolution API (Docker)

```bash
docker run -d \
  --name evolution_api \
  -p 8080:8080 \
  -e AUTHENTICATION_API_KEY=tu-api-key-secreta \
  atendai/evolution-api:latest
```

Verificar que esté corriendo:
```bash
curl http://localhost:8080
```

### 2. Configurar Variables de Entorno

En tu archivo `.env` del backend:

```env
# Evolution API Configuration
USE_EVOLUTION_API=true
EVOLUTION_API_URL=http://localhost:8080
EVOLUTION_API_KEY=tu-api-key-secreta
```

### 3. Reiniciar el Backend

```bash
# Detener backend
pm2 stop backend

# Iniciar backend
pm2 start backend
```

Verás en los logs:
```
[WhatsApp Service] 🚀 Usando Evolution API
```

## Cómo Desactivar Evolution API (Volver al Sistema Actual)

Simplemente cambia o elimina la variable en `.env`:

```env
USE_EVOLUTION_API=false
# o simplemente elimina la línea
```

Reinicia el backend y verás:
```
[WhatsApp Service] 📱 Usando whatsapp-web.js (sistema actual)
```

## Compatibilidad

### ✅ Lo que NO cambia:

- **Tabla `WhatsAppSession`**: Sigue siendo la misma, compatible con ambos sistemas
- **Endpoints existentes**: `/notifications/whatsapp/*` funcionan igual
- **Cola de mensajes**: `ScheduledMessage` sigue siendo la misma
- **Frontend**: No requiere cambios
- **Flujo de QR**: El frontend sigue recibiendo QRs de la misma forma

### ✅ Lo que mejora con Evolution API:

- **Sin desconexiones por tiempo**: No hay límite de 10 minutos
- **Menor consumo de memoria**: ~100MB vs ~600MB actual
- **Mayor estabilidad**: Servicio dedicado a WhatsApp
- **Reconexión automática**: Maneja reconexiones sin intervención

## Pruebas Recomendadas

### 1. Probar con un solo negocio primero

Antes de activar para todos:
1. Activa `USE_EVOLUTION_API=true`
2. Desconecta un negocio específico del sistema actual
3. Conéctalo usando Evolution API
4. Envía mensajes de prueba
5. Verifica que todo funcione correctamente

### 2. Monitorear logs

Observa los logs del backend para ver:
```
[Evolution API] 🚀 Iniciando gestor de instancias...
[Evolution API] 📊 X instancias encontradas en Evolution API
[Evolution API] ✅ Instancia creada: business-id
[Evolution API] 📨 Mensaje enviado a +57300...
```

### 3. Volver al sistema actual si hay problemas

Si algo no funciona:
1. `USE_EVOLUTION_API=false`
2. Reinicia backend
3. Tu sistema actual sigue funcionando igual

## Archivos Modificados

### Nuevos archivos:
- `backend/src/services/evolutionService.js` - Servicio Evolution API

### Modificados:
- `backend/src/services/whatsappService.js` - Wrapper con feature flag

### NO modificados:
- `backend/src/services/whatsapp/*` - Sistema actual intacto
- `backend/src/models/WhatsAppSession.js` - Sin cambios
- `backend/src/routes/notification.routes.js` - Sin cambios
- Frontend - Sin cambios

## Soporte

Si encuentras problemas:
1. Verifica que Evolution API esté corriendo: `curl http://localhost:8080`
2. Revisa los logs del backend para errores de Evolution API
3. Desactiva Evolution API volviendo a `USE_EVOLUTION_API=false`
4. Tu sistema actual seguirá funcionando
