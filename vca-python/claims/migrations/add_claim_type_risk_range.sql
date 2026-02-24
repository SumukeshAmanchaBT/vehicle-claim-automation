-- Add risk_min and risk_max columns to claim_type_master
-- Run this if Django migration 0005 fails or was not applied

ALTER TABLE claim_type_master
  ADD COLUMN risk_min DECIMAL(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN risk_max DECIMAL(5,2) NOT NULL DEFAULT 100;

-- Set ranges for standard claim types
UPDATE claim_type_master SET risk_min = 0,  risk_max = 50  WHERE UPPER(TRIM(claim_type_name)) = 'SIMPLE';
UPDATE claim_type_master SET risk_min = 51, risk_max = 75  WHERE UPPER(TRIM(claim_type_name)) = 'MEDIUM';
UPDATE claim_type_master SET risk_min = 76, risk_max = 100 WHERE UPPER(TRIM(claim_type_name)) = 'COMPLEX';

-- After running this SQL, mark the migration as applied (optional):
-- python manage.py migrate claims 0005 --fake
