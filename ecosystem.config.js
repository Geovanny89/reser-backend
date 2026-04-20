module.exports = {
  apps: [{
    name: 'kdice-backend',
    script: './src/server.js',
    instances: 1,           // Solo UNA instancia (WhatsApp no soporta múltiples)
    exec_mode: 'fork',      // Modo fork, NO cluster (whatsapp-web.js requiere esto)
    watch: false,
    max_memory_restart: '1G', // Reiniciar si pasa de 1GB
    
    // Importante: tiempo para limpieza graceful
    kill_timeout: 15000,    // 15 segundos para limpiar Chrome antes de matar
    wait_ready: true,       // Esperar que el proceso diga "ready"
    listen_timeout: 10000,
    
    // Variables de entorno para limitar memoria de Node
    node_args: '--max-old-space-size=512 --expose-gc',
    
    // Logs
    log_file: './logs/combined.log',
    out_file: './logs/out.log',
    error_file: './logs/error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    
    // Política de reinicio
    min_uptime: '10s',
    max_restarts: 10,
    restart_delay: 5000,
    
    // Manejo de señales
    kill_retry_time: 5000,
    
    env: {
      NODE_ENV: 'production',
      PORT: 4000
    },
    env_development: {
      NODE_ENV: 'development',
      PORT: 4000
    }
  }]
};
