# Guía para arreglar el problema de rendimiento de la Landing Page (~10s)

## Resumen del problema
La landing page (`/api/businesses/:slug/public`) tarda ~10 segundos en cargar. Las causas más probables:
1. Consultas pesadas sin índices en PostgreSQL
2. Background jobs (WhatsApp/Puppeteer/schedulers) saturando el event loop en VPS pequeño

## Cambios ya implementados en código
✅ Índices agregados en modelos: Service, Employee, Promotion, ServiceGroup, BusinessReview
✅ Índice agregado en Business.slug (crítico para la consulta principal)
✅ Switch `DISABLE_BACKGROUND_JOBS=true` en server.js (línea 14, 320-323)
✅ Logs de performance en `getBySlug` (queries.js líneas 102-254)

## Pasos para arreglar en tu VPS

### 1. Ejecutar migración de índices en PostgreSQL
Si usas PostgreSQL, ejecuta este script para asegurar que los índices se creen:

```bash
cd backend
psql -U tu_usuario -d tu_database -f migrations/add-performance-indexes.sql
```

Si usas SQLite, los índices se crean automáticamente con `sync({ alter: true })`.

### 2. Configurar DISABLE_BACKGROUND_JOBS=true en producción
En tu archivo `.env` del backend en el VPS:

```bash
DISABLE_BACKGROUND_JOBS=true
```

Esto deshabilita:
- Servicio de recordatorios automáticos
- Monitor de suscripciones
- Limpieza de mensajes viejos
- Alertas de citas pendientes
- Instancias de WhatsApp
- Schedulers de mensajes

**IMPORTANTE**: Si necesitas que estos jobs sigan corriendo, créalos en un proceso separado de PM2.

### 3. Reiniciar el backend
```bash
pm2 restart backend
# o
pm2 reload backend
```

### 4. Probar y monitorear performance
Abre la landing page en tu navegador y revisa los logs del backend:

```bash
pm2 logs backend --lines 50
```

Busca las líneas de performance:
```
[PERF getBySlug] Business.findOne=XXXms slug=...
[PERF getBySlug] Promotions+Reviews=XXXms promos=X reviews=X
[PERF getBySlug] total=XXXms slug=...
[CACHE HIT] getBySlug - ... (después de la primera carga)
```

## Interpretación de logs

- **Business.findOne > 1000ms**: Problema en la consulta principal con includes anidados
  - Solución: Los índices deberían arreglarlo
- **Promotions+Reviews > 500ms**: Problema en consultas secundarias
  - Solución: Índices en Promotion y BusinessReview
- **total > 2000ms**: Aún lento después de índices
  - Posible causa: Background jobs saturando CPU
  - Solución: DISABLE_BACKGROUND_JOBS=true o separar en otro proceso

## Arquitectura recomendada para producción

### Opción A: Single process (si no necesitas WhatsApp/schedulers en tiempo real)
```bash
# .env
DISABLE_BACKGROUND_JOBS=true
```

### Opción B: Multi-process (recomendado si necesitas WhatsApp)
```bash
# Proceso 1: API + Landing (sin background jobs)
# ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'backend-api',
      script: './src/server.js',
      env: {
        DISABLE_BACKGROUND_JOBS: 'true',
        PORT: 4000
      }
    },
    {
      name: 'backend-worker',
      script: './src/server.js',
      env: {
        DISABLE_BACKGROUND_JOBS: 'false',
        PORT: 4001  # Puerto diferente para evitar conflicto
      }
    }
  ]
}
```

Luego:
```bash
pm2 start ecosystem.config.js
pm2 save
```

## Verificar que los índices se crearon (PostgreSQL)

```sql
-- Conéctate a tu DB
psql -U tu_usuario -d tu_database

-- Ejecuta esta query
SELECT 
    schemaname,
    tablename,
    indexname
FROM pg_indexes
WHERE tablename IN ('Businesses', 'Services', 'Employees', 'Promotions', 'ServiceGroups', 'BusinessReviews')
ORDER BY tablename, indexname;
```

Deberías ver índices como:
- idx_business_slug
- idx_service_businessId
- idx_service_businessId_active
- idx_employee_businessId
- idx_promotion_businessId
- idx_promotion_date_range
- etc.

## Métricas esperadas después del fix
- **Business.findOne**: < 100ms
- **Promotions+Reviews**: < 50ms
- **total (first load)**: < 300ms
- **total (cache hit)**: < 5ms

## Si aún está lento después de estos cambios

1. Revisa el uso de CPU en el VPS:
   ```bash
   htop
   # o
   top
   ```

2. Si CPU > 80%, considera:
   - Upgrade del VPS (más CPU/RAM)
   - Separar completamente el worker de WhatsApp en otro servidor
   - Usar Redis para caché distribuido (en lugar de caché en memoria)

3. Revisa las consultas EXPLAIN en PostgreSQL:
   ```sql
   EXPLAIN ANALYZE
   SELECT * FROM "Businesses" 
   WHERE "slug" = 'tu-slug';
   ```

## Contacto
Si después de aplicar estos cambios sigues con problemas, comparte:
1. 5-10 líneas de log con `[PERF getBySlug]`
2. Output de `htop` durante la carga
3. Si usas PostgreSQL o SQLite
4. Especificaciones de tu VPS (CPU/RAM)
