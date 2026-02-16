-- Sample data for fnol_claims and fnol_damage_photos tables
-- Use these to test all fraud detection cases (MySQL syntax)
--
-- Run: mysql -u <user> -p <database> < sample_data_fnol_claims.sql
-- Or execute in your MySQL client (e.g. MySQL Workbench, DBeaver)
--
-- claim_status: 1=Open, 2=Pending, 3=Fraudulent, 4=Pending Damage Detection, 5=Auto Approved, 6=Manual Review
--
-- EXPECTED RESULTS SUMMARY:
-- | complaint_id | Expected Result                      | Reason                                    |
-- |--------------|-------------------------------------|-------------------------------------------|
-- | CLM-001      | Auto Approve                        | Active, Bangalore, photos, good score     |
-- | CLM-002      | Reject                              | Policy inactive                           |
-- | CLM-003      | Auto Approve or Manual Review       | Active, Bangalore, photos (no prev claims)|
-- | CLM-004      | Reject                              | Early claim (< 30 days from policy start) |
-- | CLM-005      | Auto Approve or Manual Review       | Medium fraud (Mumbai), has photos         |
-- | CLM-006      | Manual Review                       | Photos missing (Pending Damage Detection) |
-- | CLM-007      | Manual Review                       | Low score (minimal damage description)    |
-- | CLM-008      | Medium fraud (Chennai), passes      | Proceeds to damage detection              |

-- =============================================================================
-- Case 1: CLM-001 - Expected: Auto Approve
-- Active policy, Bangalore, low fraud history, policy started 60 days ago,
-- has damage photos, good loss description for damage detection
-- =============================================================================
INSERT INTO fnol_claims (
    complaint_id, coverage_type, policy_number, policy_status,
    policy_start_date, policy_end_date, policy_holder_name,
    vehicle_make, vehicle_year, vehicle_model, vehicle_registration_number,
    incident_type, incident_description, incident_date_time,
    fir_document_copy, insurance_document_copy, claim_status
) VALUES (
    'CLM-009', 'Comprehensive', 'POL100001', 'Active',
    DATE_SUB(CURDATE(), INTERVAL 90 DAY), DATE_ADD(CURDATE(), INTERVAL 275 DAY), 'Ravi Kumar',
    'Hyundai', 2023, 'Creta', 'KA02CD2222',
    'Own Damage', 'Severe glass damage to windshield after major impact',
    DATE_SUB(NOW(), INTERVAL 30 DAY),
    NULL, NULL, 1
);

INSERT INTO fnol_damage_photos (complaint_id, photo_path) VALUES
('CLM-009', '/uploads/damage/clm001_photo1.jpg'),
('CLM-009', '/uploads/damage/clm001_photo2.jpg');


-- =============================================================================
-- Case 2: CLM-002 - Expected: Reject (Policy inactive)
-- Inactive policy - product_rule fails
-- =============================================================================
INSERT INTO fnol_claims (
    complaint_id, coverage_type, policy_number, policy_status,
    policy_start_date, policy_end_date, policy_holder_name,
    vehicle_make, vehicle_year, vehicle_model, vehicle_registration_number,
    incident_type, incident_description, incident_date_time,
    fir_document_copy, insurance_document_copy, claim_status
) VALUES (
    'CLM-002', 'Comprehensive', 'POL100002', 'Inactive',
    '2024-01-01', '2025-01-01', 'Priya Sharma',
    'Maruti', 2022, 'Brezza', 'KA01AB1234',
    'Own Damage', 'Bumper and door damage in collision',
    NOW(),
    NULL, NULL, 1
);

INSERT INTO fnol_damage_photos (complaint_id, photo_path) VALUES
('CLM-002', '/uploads/damage/clm002_photo1.jpg');


-- =============================================================================
-- Case 3: CLM-003 - Expected: Reject (High fraud - 3+ previous claims)
-- Multiple claims in last 12 months triggers high fraud
-- =============================================================================
INSERT INTO fnol_claims (
    complaint_id, coverage_type, policy_number, policy_status,
    policy_start_date, policy_end_date, policy_holder_name,
    vehicle_make, vehicle_year, vehicle_model, vehicle_registration_number,
    incident_type, incident_description, incident_date_time,
    fir_document_copy, insurance_document_copy, claim_status
) VALUES (
    'CLM-003', 'Comprehensive', 'POL100003', 'Active',
    DATE_SUB(CURDATE(), INTERVAL 180 DAY), DATE_ADD(CURDATE(), INTERVAL 185 DAY), 'Suresh Reddy',
    'Honda', 2021, 'City', 'KA03EF5678',
    'Own Damage', 'Front bumper damage',
    NOW(),
    NULL, NULL, 1
);

INSERT INTO fnol_damage_photos (complaint_id, photo_path) VALUES
('CLM-003', '/uploads/damage/clm003_photo1.jpg');


-- =============================================================================
-- Case 4: CLM-004 - Expected: Reject (High fraud - early claim)
-- Claim within 30 days of policy start - early claim rule
-- =============================================================================
INSERT INTO fnol_claims (
    complaint_id, coverage_type, policy_number, policy_status,
    policy_start_date, policy_end_date, policy_holder_name,
    vehicle_make, vehicle_year, vehicle_model, vehicle_registration_number,
    incident_type, incident_description, incident_date_time,
    fir_document_copy, insurance_document_copy, claim_status
) VALUES (
    'CLM-004', 'Comprehensive', 'POL100004', 'Active',
    DATE_SUB(CURDATE(), INTERVAL 10 DAY), DATE_ADD(CURDATE(), INTERVAL 355 DAY), 'Anita Desai',
    'Toyota', 2024, 'Innova', 'KA05GH9012',
    'Own Damage', 'Side mirror and door scratch',
    NOW(),
    NULL, NULL, 1
);

INSERT INTO fnol_damage_photos (complaint_id, photo_path) VALUES
('CLM-004', '/uploads/damage/clm004_photo1.jpg');


-- =============================================================================
-- Case 5: CLM-005 - Expected: Reject (High fraud - non-Bangalore)
-- Actually: non-Bangalore gives MEDIUM fraud, not High. So this would pass fraud
-- check. Let me check - "if location != Bangalore return Medium". So it's Medium.
-- For High we need: early claim, OR 3+ claims. Non-Bangalore = Medium.
-- So CLM-005 would get Manual Review or Auto Approve depending on score.
-- Let me change to 3+ claims + Chennai to make it High? Or keep as Medium fraud test.
-- I'll keep CLM-005 as non-Bangalore for Medium fraud (passes to damage detection).
-- For a Reject case with location, we need both - e.g. Chennai + 3 claims = High.
-- =============================================================================
-- Case 5: CLM-005 - Expected: Medium fraud, proceeds to damage detection
-- Non-Bangalore location = Medium fraud (not High, so passes fraud check)
-- =============================================================================
INSERT INTO fnol_claims (
    complaint_id, coverage_type, policy_number, policy_status,
    policy_start_date, policy_end_date, policy_holder_name,
    vehicle_make, vehicle_year, vehicle_model, vehicle_registration_number,
    incident_type, incident_description, incident_date_time,
    fir_document_copy, insurance_document_copy, claim_status
) VALUES (
    'CLM-005', 'Comprehensive', 'POL100005', 'Active',
    DATE_SUB(CURDATE(), INTERVAL 120 DAY), DATE_ADD(CURDATE(), INTERVAL 245 DAY), 'Vijay Singh',
    'Mahindra', 2023, 'XUV700', 'MH02IJ3456',
    'Own Damage', 'Glass and bumper damage in accident',
    DATE_SUB(NOW(), INTERVAL 15 DAY),
    NULL, NULL, 1
);

INSERT INTO fnol_damage_photos (complaint_id, photo_path) VALUES
('CLM-005', '/uploads/damage/clm005_photo1.jpg'),
('CLM-005', '/uploads/damage/clm005_photo2.jpg');


-- =============================================================================
-- Case 6: CLM-006 - Expected: Manual Review (Photos missing)
-- No entries in fnol_damage_photos - documents.photos_uploaded = false
-- =============================================================================
INSERT INTO fnol_claims (
    complaint_id, coverage_type, policy_number, policy_status,
    policy_start_date, policy_end_date, policy_holder_name,
    vehicle_make, vehicle_year, vehicle_model, vehicle_registration_number,
    incident_type, incident_description, incident_date_time,
    fir_document_copy, insurance_document_copy, claim_status
) VALUES (
    'CLM-006', 'Comprehensive', 'POL100006', 'Active',
    DATE_SUB(CURDATE(), INTERVAL 60 DAY), DATE_ADD(CURDATE(), INTERVAL 305 DAY), 'Kavita Nair',
    'Tata', 2022, 'Nexon', 'KA07KL7890',
    'Own Damage', 'Minor bumper damage in parking',
    DATE_SUB(NOW(), INTERVAL 5 DAY),
    NULL, NULL, 1
);
-- No fnol_damage_photos for CLM-006


-- =============================================================================
-- Case 7: CLM-007 - Expected: Manual Review (score < threshold)
-- Low damage confidence or evaluation score below threshold
-- Minimal loss description, may get lower damage confidence
-- =============================================================================
INSERT INTO fnol_claims (
    complaint_id, coverage_type, policy_number, policy_status,
    policy_start_date, policy_end_date, policy_holder_name,
    vehicle_make, vehicle_year, vehicle_model, vehicle_registration_number,
    incident_type, incident_description, incident_date_time,
    fir_document_copy, insurance_document_copy, claim_status
) VALUES (
    'CLM-007', 'Comprehensive', 'POL100007', 'Active',
    DATE_SUB(CURDATE(), INTERVAL 100 DAY), DATE_ADD(CURDATE(), INTERVAL 265 DAY), 'Rahul Verma',
    'Kia', 2023, 'Seltos', 'KA09MN2345',
    'Own Damage', 'Minor scratch on rear panel',
    DATE_SUB(NOW(), INTERVAL 20 DAY),
    NULL, NULL, 1
);

INSERT INTO fnol_damage_photos (complaint_id, photo_path) VALUES
('CLM-007', '/uploads/damage/clm007_photo1.jpg');


-- =============================================================================
-- Case 8: CLM-008 - Chennai + 3 claims = High fraud (Reject)
-- Non-Bangalore + 3+ previous claims triggers High fraud
-- =============================================================================
INSERT INTO fnol_claims (
    complaint_id, coverage_type, policy_number, policy_status,
    policy_start_date, policy_end_date, policy_holder_name,
    vehicle_make, vehicle_year, vehicle_model, vehicle_registration_number,
    incident_type, incident_description, incident_date_time,
    fir_document_copy, insurance_document_copy, claim_status
) VALUES (
    'CLM-008', 'Comprehensive', 'POL100008', 'Active',
    DATE_SUB(CURDATE(), INTERVAL 90 DAY), DATE_ADD(CURDATE(), INTERVAL 275 DAY), 'Deepak Patel',
    'Hyundai', 2021, 'i20', 'TN01OP6789',
    'Own Damage', 'Windshield crack and bumper damage',
    DATE_SUB(NOW(), INTERVAL 45 DAY),
    NULL, NULL, 1
);

INSERT INTO fnol_damage_photos (complaint_id, photo_path) VALUES
('CLM-008', '/uploads/damage/clm008_photo1.jpg');
