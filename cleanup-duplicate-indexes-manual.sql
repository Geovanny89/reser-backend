-- Script para limpiar índices duplicados en PostgreSQL
-- Este script debe ejecutarse directamente en la base de datos
-- Uso: psql -U usuario -d base_de_datos -f cleanup-duplicate-indexes-manual.sql

-- Paso 1: Identificar índices duplicados en Users
SELECT 
    indexname,
    indexdef
FROM pg_indexes 
WHERE tablename = 'users' 
AND indexname LIKE 'users_email_key%'
ORDER BY indexname;

-- Paso 2: Identificar índices duplicados en Businesses
SELECT 
    indexname,
    indexdef
FROM pg_indexes 
WHERE tablename = 'businesses' 
AND indexname LIKE 'businesses_slug_key%'
ORDER BY indexname;

-- Paso 3: Eliminar constraints asociados a los índices duplicados
-- NOTA: Primero debemos eliminar las UNIQUE CONSTRAINTS que usan estos índices
-- Luego recrearlas con el índice correcto

-- Para Users - mantener solo users_email_key y eliminar los demás
-- Ejecutar estos comandos uno por uno después de verificar:

-- ALTER TABLE "Users" DROP CONSTRAINT IF EXISTS "Users_email_key1";
-- ALTER TABLE "Users" DROP CONSTRAINT IF EXISTS "Users_email_key2";
-- ... continuar para todos los duplicados hasta Users_email_key721

-- Para Businesses - mantener solo businesses_slug_key y eliminar los demás
-- ALTER TABLE "Businesses" DROP CONSTRAINT IF EXISTS "Businesses_slug_key1";
-- ALTER TABLE "Businesses" DROP CONSTRAINT IF EXISTS "Businesses_slug_key2";
-- ... continuar para todos los duplicados hasta Businesses_slug_key717

-- Paso 4: Después de eliminar las constraints, eliminar los índices huérfanos
-- DROP INDEX IF EXISTS "Users_email_key1";
-- DROP INDEX IF EXISTS "Users_email_key2";
-- ... continuar para todos

-- DROP INDEX IF EXISTS "Businesses_slug_key1";
-- DROP INDEX IF EXISTS "Businesses_slug_key2";
-- ... continuar para todos

-- Paso 5: Verificar que solo queden los índices correctos
SELECT indexname 
FROM pg_indexes 
WHERE tablename = 'users' 
AND indexname LIKE 'users_email_key%'
ORDER BY indexname;

SELECT indexname 
FROM pg_indexes 
WHERE tablename = 'businesses' 
AND indexname LIKE 'businesses_slug_key%'
ORDER BY indexname;
