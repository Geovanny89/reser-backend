module.exports = {
  apps: [{
    name: 'kdice-backend',
    script: './src/server.js',
    instances: 1,              // Una sola instancia para total consistencia
    exec_mode: 'fork',         // Modo fork estable
    watch: false,
    max_memory_restart: '4G',  // Límite de 4GB para evitar cuelgues
    
    // Configuración de limpieza y reinicio
    kill_timeout: 15000,    
    wait_ready: true,       
    listen_timeout: 10000,
    
    // Límites de memoria para Node.js (4GB de 8GB disponibles)
    node_args: '--max-old-space-size=4096 --expose-gc',
    
    // Rutas de logs
    log_file: './logs/combined.log',
    out_file: './logs/out.log',
    error_file: './logs/error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    
    // Política de estabilidad
    min_uptime: '10s',
    max_restarts: 10,
    restart_delay: 5000,
    
    env: {
      NODE_ENV: 'production',
      PORT: 4000
    }
  }]
};
