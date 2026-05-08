# Guía de Configuración para VPS - Evolution API

## Problema Identificado

El código tenía `localhost:8080` hardcoded en `constants.js`, lo que funcionaba en local pero no en la VPS. Ya fue corregido para usar la variable de entorno `EVOLUTION_API_URL`.

## Pasos para Configurar en VPS

### 1. Configurar variables de entorno en el backend (CRÍTICO)

**ESTE ES EL PASO MÁS IMPORTANTE**: El error `connect ECONNREFUSED 127.0.0.1:8080` ocurre porque el backend no tiene la variable `EVOLUTION_API_URL` configurada.

En el archivo `.env` del backend (en la VPS), agrega o modifica estas variables:

```env
# Evolution API Configuration
USE_EVOLUTION_API=true
EVOLUTION_API_URL=http://72.62.165.89:8080
EVOLUTION_API_KEY=1234
BACKEND_URL=http://72.62.165.89:4000
```

**IMPORTANTE**: 
- Reemplaza `72.62.165.89` con la IP pública de tu VPS si es diferente
- `BACKEND_URL` es necesaria para que los webhooks funcionen correctamente
- Sin estas variables, el backend usará `localhost:8080` por defecto y fallará

**Referencia**: Usa el archivo `.env.vps.example` como plantilla.

### 2. Verificar docker-compose.yml

El archivo `docker-compose.yml` ya tiene la configuración correcta para VPS:

```yaml
environment: 
  - SERVER_URL=http://72.62.165.89:8080
  - WEBHOOK_GLOBAL_URL=http://72.62.165.89:4000/api/notifications/evolution/webhook
```

Asegúrate de que la IP sea la correcta para tu VPS.

### 3. Abrir puertos en el firewall de la VPS

Asegúrate de que los siguientes puertos estén abiertos en tu VPS:

- **8080**: Para Evolution API
- **4000**: Para el backend (webhook)

Ejemplo con UFW (Ubuntu):
```bash
sudo ufw allow 8080/tcp
sudo ufw allow 4000/tcp
sudo ufw reload
```

Ejemplo con firewalld (CentOS/RHEL):
```bash
sudo firewall-cmd --permanent --add-port=8080/tcp
sudo firewall-cmd --permanent --add-port=4000/tcp
sudo firewall-cmd --reload
```

### 4. Reiniciar servicios (CRÍTICO - Despues de modificar .env)

```bash
# Detener containers existentes
cd /ruta/a/backend
docker-compose down

# Iniciar containers
docker-compose up -d

# Verificar que Evolution API esté corriendo
docker logs evolution_api

# Reiniciar backend (IMPORTANTE: para cargar las nuevas variables de entorno)
pm2 restart backend
# o si usas docker para el backend también
docker restart backend_container
```

### 5. Verificar conexión

```bash
# Verificar que Evolution API responda
curl http://72.62.165.89:8080

# Verificar instancias
curl -H "apikey: 1234" http://72.62.165.89:8080/instance/fetchInstances
```

### 6. Verificar logs del backend

```bash
# Si usas PM2
pm2 logs backend

# Si usas Docker
docker logs backend_container
```

Busca estos mensajes:
```
[WhatsApp Service] 🚀 Usando Evolution API
[Evolution API] 🚀 Iniciando gestor de instancias...
```

## Solución de Problemas Comunes

### Error: Connection refused
- **Causa**: Puerto 8080 no abierto en firewall
- **Solución**: Abre el puerto 8080 en el firewall de la VPS

### Error: Webhook not reachable
- **Causa**: El webhook URL no es accesible desde Evolution API
- **Solución**: Verifica que la IP en WEBHOOK_GLOBAL_URL sea correcta y el puerto 4000 esté abierto

### Error: Instance not found
- **Causa**: Las instancias no se están creando correctamente
- **Solución**: Revisa los logs de Evolution API y verifica que el backend tenga las credenciales correctas

### Error: Timeout al conectar
- **Causa**: Problemas de red o proxy
- **Solución**: Verifica que Evolution API pueda acceder a internet y que no haya bloqueos de red

## Verificación Final

1. **Evolution API accesible**: `curl http://TU_IP:8080`
2. **Backend configurado**: Verifica que `.env` tenga `EVOLUTION_API_URL=http://TU_IP:8080`
3. **Puertos abiertos**: 8080 y 4000
4. **Logs sin errores**: Revisa logs de Evolution API y backend
5. **Conexión WhatsApp**: Intenta conectar una instancia y escanear el QR

## Archivos Modificados

- ✅ `backend/src/services/evolution/constants.js` - Ahora usa `process.env.EVOLUTION_API_URL` en lugar de localhost hardcoded
- ✅ `backend/docker-compose.yml` - Puerto cambiado a `0.0.0.0:8080:8080` para acceso desde IP pública
- ✅ `backend/.env.vps.example` - Plantilla de configuración para VPS
