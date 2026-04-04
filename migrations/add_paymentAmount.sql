-- Migration: Add paymentAmount column to Businesses table
-- Run this in your PostgreSQL database on the VPS

-- Check if column exists first, then add it
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'Businesses' 
    AND column_name = 'paymentAmount'
  ) THEN
    ALTER TABLE "Businesses" ADD COLUMN "paymentAmount" DECIMAL(10, 2);
    RAISE NOTICE 'Column paymentAmount added successfully';
  ELSE
    RAISE NOTICE 'Column paymentAmount already exists';
  END IF;
END $$;
