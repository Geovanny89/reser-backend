# Configuración PM2 para Producción

## Problema de memoria resuelto

Los picos de 8GB de RAM se debían a que **Chrome no se cerraba correctamente** cuando PM2 reiniciaba el backend. Ahora hay manejadores de señales que limpian graceful.

## Configuración

El archivo `ecosystem.config.js` incluye:
- **1 sola instancia** (WhatsApp no soporta múltiples procesos)
- **max_memory_restart: 1G** (reinicia automáticamente si pasa 1GB)
- **kill_timeout: 15s** (tiempo para limpiar Chrome antes de matar el proceso)
- **node_args**: limita memoria de Node a 512MB

## Comandos PM2

```bash
# Iniciar con configuración
pm2 start ecosystem.config.js

# Ver estado
pm2 status
pm2 logs kdice-backend

# Monitoreo en tiempo real
pm2 monit

# Reiniciar
pm2 restart kdice-backend

# Detener
pm2 stop kdice-backend

# Eliminar
pm2 delete kdice-backend
```

## Si hay problemas de memoria

### 1. Limpieza manual de Chrome

```bash
# Detener backend
pm2 stop kdice-backend

# Limpiar procesos Chrome zombie
node scripts/cleanup-chrome.js

# Reiniciar
pm2 start ecosystem.config.js
```

### 2. Ver procesos Chrome actuales

```bash
# Linux/Mac
ps aux | grep chrome | grep -v grep

# Windows (CMD)
tasklist | findstr chrome
```

### 3. Matar todos los procesos Chrome (emergencia)

```bash
# Linux/Mac
pkill -9 chrome

# Windows
wmic process where "name='chrome.exe'" delete
```

## Logs importantes

Busca estos mensajes en los logs:

```
✅ Limpieza completada. Saliendo...  # Cierre graceful correcto
🧹 Chrome zombie limpiados          # Limpieza automática funcionó
⚠️ ALTO CONSUMO DE MEMORIA          # Alerta de memoria > 1.5GB
```

## Configuración VPS recomendada

- **RAM mínima**: 2GB
- **RAM recomendada**: 4GB (para múltiples sesiones WhatsApp)
- **Swap**: 2GB mínimo

## Variables de entorno útiles

```bash
# En ecosystem.config.js o .env
NODE_OPTIONS="--max-old-space-size=512"
PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true  # Si instalas Chrome manualmente
```

## Troubleshooting

### PM2 muestra "errored"

```bash
# Ver logs de error
pm2 logs kdice-backend --err

# Reiniciar limpiando todo
pm2 delete kdice-backend
node scripts/cleanup-chrome.js
pm2 start ecosystem.config.js
```

### Memoria sigue creciendo

1. Verificar que solo hay 1 instancia: `pm2 status` (debe mostrar "1" en instances)
2. Si hay múltiples instancias, usar: `pm2 delete all` y volver a iniciar
3. Ejecutar limpieza manual de Chrome

### WhatsApp se desconecta

Es normal que WhatsApp se desconecte después de enviar mensajes (diseño ahorrador de RAM). Se reconectará automáticamente cuando sea necesario.
