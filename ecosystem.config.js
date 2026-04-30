module.exports = {
  apps: [{
    name: 'kdice-backend',
    script: './src/server.js',
    instances: 2,              // 2 instancias (una por cada núcleo de tu vCPU)
    exec_mode: 'cluster',      // Modo cluster para máxima eficiencia
    watch: false,
    max_memory_restart: '2G',  // Reiniciar si una instancia llega a 2GB (tienes 8GB, así que es seguro)
    
    // Importante: tiempo para limpieza graceful
    kill_timeout: 15000,    // 15 segundos para limpieza antes de matar
    wait_ready: true,       // Esperar que el proceso diga "ready"
    listen_timeout: 10000,
    
    // Variables de entorno para limitar memoria de Node - 2GB es ideal para tu RAM
    node_args: '--max-old-space-size=2048 --expose-gc',
    
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
