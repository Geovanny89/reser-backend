#!/bin/bash

# Script para sincronizar APK desde local al servidor Ubuntu
# Ejecutar este script en el servidor Ubuntu

echo "🔄 Sincronizando APK desde local..."

# Rutas
LOCAL_APK_PATH="$HOME/kdice-final-v5/frontend/android/app/build/outputs/apk/debug/app-debug.apk"
SERVER_UPLOADS_PATH="/var/www/reservas-backend/uploads"

# Verificar si existe el APK local
if [ ! -f "$LOCAL_APK_PATH" ]; then
    echo "❌ No se encuentra el APK local en: $LOCAL_APK_PATH"
    echo "💡 Genera el APK localmente primero:"
    echo "   cd ~/kdice-final-v5/frontend && npm run apk:debug"
    exit 1
fi

# Copiar APK al servidor
echo "📦 Copiando APK al servidor..."
cp "$LOCAL_APK_PATH" "$SERVER_UPLOADS_PATH/kdice-app.apk"

# Verificar que se copió correctamente
if [ -f "$SERVER_UPLOADS_PATH/kdice-app.apk" ]; then
    echo "✅ APK sincronizada exitosamente"
    echo "📂 Ubicación: $SERVER_UPLOADS_PATH/kdice-app.apk"
    
    # Reiniciar backend si es necesario
    echo "🔄 Reiniciando backend..."
    sudo systemctl restart reservas-backend
    
    echo "🎉 APK disponible en producción"
else
    echo "❌ Error al copiar la APK"
    exit 1
fi
