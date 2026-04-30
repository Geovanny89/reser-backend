-- Migración para crear índices de performance en PostgreSQL
-- Ejecutar en tu VPS: psql -U tu_usuario -d tu_database -f migrations/add-performance-indexes.sql

-- Índice en Business.slug (crítico para la landing page)
CREATE INDEX IF NOT EXISTS idx_business_slug ON "Businesses"("slug");

-- Índices en Service
CREATE INDEX IF NOT EXISTS idx_service_businessId ON "Services"("businessId");
CREATE INDEX IF NOT EXISTS idx_service_businessId_active ON "Services"("businessId", "active");
CREATE INDEX IF NOT EXISTS idx_service_serviceGroupId ON "Services"("serviceGroupId");

-- Índices en Employee
CREATE INDEX IF NOT EXISTS idx_employee_businessId ON "Employees"("businessId");
CREATE INDEX IF NOT EXISTS idx_employee_businessId_active ON "Employees"("businessId", "active");
CREATE INDEX IF NOT EXISTS idx_employee_userId ON "Employees"("userId");

-- Índices en Promotion
CREATE INDEX IF NOT EXISTS idx_promotion_businessId ON "Promotions"("businessId");
CREATE INDEX IF NOT EXISTS idx_promotion_businessId_active ON "Promotions"("businessId", "active");
CREATE INDEX IF NOT EXISTS idx_promotion_serviceId ON "Promotions"("serviceId");
CREATE INDEX IF NOT EXISTS idx_promotion_date_range ON "Promotions"("startDate", "endDate");

-- Índices en ServiceGroup
CREATE INDEX IF NOT EXISTS idx_serviceGroup_businessId ON "ServiceGroups"("businessId");
CREATE INDEX IF NOT EXISTS idx_serviceGroup_businessId_active ON "ServiceGroups"("businessId", "active");

-- Índices en BusinessReview
CREATE INDEX IF NOT EXISTS idx_businessReview_businessId ON "BusinessReviews"("businessId");
CREATE INDEX IF NOT EXISTS idx_businessReview_businessId_isApproved ON "BusinessReviews"("businessId", "isApproved");
CREATE INDEX IF NOT EXISTS idx_businessReview_createdAt ON "BusinessReviews"("createdAt");

-- Verificar índices creados
SELECT 
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename IN ('Businesses', 'Services', 'Employees', 'Promotions', 'ServiceGroups', 'BusinessReviews')
ORDER BY tablename, indexname;
