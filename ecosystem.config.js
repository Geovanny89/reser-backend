module.exports = {
  apps: [{
    name: 'kdice-backend',
    script: './src/server.js',
    instances: 3,           // 3 instancias para soportar 200+ usuarios (configuración estable)
    exec_mode: 'cluster',      // Modo cluster
    watch: false,
<<<<<<< HEAD
    max_memory_restart: '3G', // Reiniciar si pasa de 3GB

=======
    max_memory_restart: '1.5G', // 1.5GB por instancia (total 4.5GB), deja espacio para DB, SO y otros servicios
    
>>>>>>> b9db091 ( se refactoriza el codigo y se modulariza)
    // Importante: tiempo para limpieza graceful
    kill_timeout: 15000,    // 15 segundos para limpieza antes de matar
    wait_ready: true,       // Esperar que el proceso diga "ready"
    listen_timeout: 10000,
<<<<<<< HEAD

    // Variables de entorno para limitar memoria de Node - AUMENTADO a 2GB
    node_args: '--max-old-space-size=2048 --expose-gc',
=======
    
    // Variables de entorno para limitar memoria de Node
    node_args: '--max-old-space-size=1536 --expose-gc',
>>>>>>> b9db091 ( se refactoriza el codigo y se modulariza)
    
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
