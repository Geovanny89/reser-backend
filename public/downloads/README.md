# Carpeta de Descargas de APKs

Esta carpeta contiene las APKs generadas manualmente para distribución.

## 📱 APKs Disponibles

- `kdice-app.apk` - APK universal con todas las funcionalidades
- `kdice-{slug}.apk` - APKs personalizadas por negocio (generadas automáticamente)

## 🔄 Proceso de Actualización

1. **Generar APK localmente**:
   ```bash
   cd frontend
   npm run apk:debug
   ```

2. **Copiar APK a esta carpeta**:
   ```bash
   copy android/app/build/outputs/apk/debug/app-debug.apk public/downloads/kdice-app.apk
   ```

3. **Acceder desde la web**:
   - URL: `/downloads/kdice-app.apk`
   - Descarga directa sin autenticación

## 🎯 Uso

- **Dueños de negocios**: Descargan la APK desde su panel
- **Empleados**: Usan la misma APK para acceder a su negocio
- **Clientes**: Pueden descargar la APK para reservar

## 📋 Notas

- Las APKs se generan localmente con Android Studio
- Se suben manualmente a esta carpeta
- El sistema crea copias personalizadas automáticamente
