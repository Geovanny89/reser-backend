#!/usr/bin/env node

/**
 * ⚠️ SCRIPT DE LIMPIEZA DE CHROME - USAR CON PRECAUCIÓN
 * 
 * Este script mata procesos Chrome zombie (huérfanos).
 * IMPORTANTE: Detener el backend ANTES de ejecutar este script
 * si quieres limpiar TODO. Si el backend está corriendo, usa
 * la limpieza automática que ya está implementada.
 * 
 * Uso seguro:
 *   pm2 stop kdice-backend        # o pm2 delete kdice-backend
 *   node scripts/cleanup-chrome.js
 *   pm2 start ecosystem.config.js
 */

const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

console.log('🧹 Script de limpieza de Chrome para Kdice\n');
console.log('⚠️  ADVERTENCIA: Si el backend está corriendo, WhatsApp se desconectará\n');

async function checkBackendRunning() {
  try {
    const { stdout } = await execAsync('pm2 list | grep kdice-backend | grep -v grep');
    if (stdout.includes('online') || stdout.includes('errored')) {
      console.log('🔴 El backend está corriendo en PM2');
      console.log('   Usa: pm2 stop kdice-backend antes de limpiar Chrome');
      console.log('   O usa la limpieza automática del propio backend\n');
      return true;
    }
  } catch (e) {}
  return false;
}

async function cleanup() {
  try {
    // 0. Verificar si backend está corriendo
    const isRunning = await checkBackendRunning();
    
    // 1. Mostrar procesos Chrome actuales
    console.log('📋 Procesos Chrome actuales:');
    try {
      if (process.platform === 'win32') {
        const { stdout } = await execAsync('wmic process where "name=\'chrome.exe\'" get ProcessId,ParentProcessId,CommandLine /format:csv 2>nul');
        const lines = stdout.trim().split('\n').filter(l => l.includes('chrome') && l.includes('session-'));
        console.log(`   Encontrados: ${lines.length} procesos Chrome con sesiones`);
        
        // Mostrar cuáles son zombies (sin padre)
        let zombies = 0;
        for (const line of lines) {
          const parts = line.split(',');
          const ppid = parts[2]?.trim();
          if (ppid) {
            try {
              await execAsync(`tasklist /FI "PID eq ${ppid}" 2>nul | findstr ${ppid}`);
            } catch {
              zombies++;
            }
          }
        }
        if (zombies > 0) {
          console.log(`   🧟 Zombies (sin padre): ${zombies}`);
        }
      } else {
        const { stdout } = await execAsync('ps aux | grep chrome | grep session | grep -v grep | wc -l');
        const count = parseInt(stdout.trim()) || 0;
        console.log(`   Procesos Chrome con sesiones: ${count}`);
        
        // Verificar zombies (PPID = 1)
        const { stdout: zombieOut } = await execAsync('ps -eo pid,ppid,comm,args | grep chrome | grep session | awk \'$2 == 1 {print}\' | wc -l');
        const zombieCount = parseInt(zombieOut.trim()) || 0;
        if (zombieCount > 0) {
          console.log(`   🧟 Zombies (adoptados por init): ${zombieCount}`);
        }
      }
    } catch (e) {
      console.log('   No se pudieron listar procesos');
    }

    // 2. Solo matar zombies (procesos huérfanos), no todos los chrome
    console.log('\n🔨 Matando SOLO procesos Chrome zombie (huérfanos)...');
    let killed = 0;
    
    if (process.platform === 'win32') {
      // Buscar chrome huérfanos y matarlos uno por uno
      try {
        const { stdout } = await execAsync('wmic process where "name=\'chrome.exe\' and CommandLine like \'%session-%\'" get ProcessId,ParentProcessId /format:csv 2>nul');
        const lines = stdout.trim().split('\n').filter(l => l.includes('chrome'));
        
        for (const line of lines) {
          const parts = line.split(',');
          const pid = parts[1]?.trim();
          const ppid = parts[2]?.trim();
          
          // Verificar si el padre existe
          try {
            await execAsync(`tasklist /FI "PID eq ${ppid}" 2>nul | findstr ${ppid}`);
            // Padre existe, no tocar
          } catch {
            // Padre no existe, es zombie
            try {
              await execAsync(`taskkill /F /PID ${pid} 2>nul`);
              killed++;
            } catch {}
          }
        }
      } catch (e) {}
    } else {
      // Linux/Mac: matar solo chrome con PPID = 1 (zombies)
      try {
        const { stdout } = await execAsync('ps -eo pid,ppid,comm,args | grep chrome | grep session | grep -v grep');
        const lines = stdout.trim().split('\n');
        
        for (const line of lines) {
          const parts = line.trim().split(/\s+/);
          const pid = parts[0];
          const ppid = parts[1];
          
          if (ppid === '1') {
            try {
              process.kill(parseInt(pid), 'SIGTERM');
              killed++;
            } catch {}
          }
        }
      } catch (e) {}
    }
    
    if (killed > 0) {
      console.log(`   ✅ ${killed} procesos Chrome zombie eliminados`);
    } else {
      console.log('   ℹ️ No se encontraron procesos zombie (o ya fueron limpiados)');
    }

    // 3. Limpiar archivos de lock
    console.log('\n🗑️ Limpiando archivos de bloqueo...');
    const fs = require('fs');
    const path = require('path');
    const sessionsDir = path.resolve(__dirname, '../sessions');
    
    if (fs.existsSync(sessionsDir)) {
      const lockFiles = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];
      let cleaned = 0;
      
      const subdirs = fs.readdirSync(sessionsDir);
      for (const dir of subdirs) {
        const sessionPath = path.join(sessionsDir, dir);
        if (fs.statSync(sessionPath).isDirectory()) {
          for (const lockFile of lockFiles) {
            const lockPath = path.join(sessionPath, lockFile);
            if (fs.existsSync(lockPath)) {
              try {
                fs.unlinkSync(lockPath);
                cleaned++;
              } catch (e) {
                // No se pudo borrar
              }
            }
          }
        }
      }
      
      console.log(`   ✅ ${cleaned} archivos de bloqueo eliminados`);
    }

    // 4. Forzar garbage collection si está disponible
    if (global.gc) {
      console.log('\n🗑️ Forzando garbage collection...');
      global.gc();
      console.log('   ✅ Garbage collection ejecutado');
    }

    // 5. Mostrar memoria actual
    const used = process.memoryUsage();
    console.log('\n📊 Memoria del proceso Node:');
    console.log(`   Heap usado: ${Math.round(used.heapUsed / 1024 / 1024)}MB`);
    console.log(`   RSS: ${Math.round(used.rss / 1024 / 1024)}MB`);

    console.log('\n✅ Limpieza completada!');
    console.log('\n💡 Para reiniciar el backend:');
    console.log('   pm2 restart kdice-backend');
    
  } catch (err) {
    console.error('❌ Error durante limpieza:', err.message);
    process.exit(1);
  }
}

cleanup();
