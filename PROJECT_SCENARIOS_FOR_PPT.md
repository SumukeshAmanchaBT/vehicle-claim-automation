# Vehicle Insurance Automated Claims Processing – Project Scenarios (PPT Reference)

This document summarizes how the **ClaimFlow AI** project runs in different scenarios. Use these points to build your presentation.

---

## 1. Project Overview

- **Product name:** ClaimFlow AI (Insurance Platform)
- **Stack:** React (Vite + TypeScript) frontend; Django REST (Python) backend; MySQL/SQLite; Token auth
- **Purpose:** Automate vehicle insurance claim processing with FNOL intake, fraud rule validation, and AI-based damage assessment

---

## 2. User Access & Authentication

- **Login:** Username/password → backend returns token; token stored in `localStorage` and sent as `Authorization: Token <token>` on API calls
- **Protected routes:** Dashboard, Claims, Fraud Detection, Damage Detection, Reports, Users, Roles, Role Permissions, Master Data, Settings — all require login
- **Public routes:** Login, Forgot Password, Change Password
- **Role-based UI:** Sidebar and pages show/hide by permission (e.g. `dashboard.view`, `claims.view`, `fraud.view`, `users.view`, `damage_config.view`). Admin role can see all

---

## 3. Claim Lifecycle & Statuses (Backend)

- **Initial:** Claim created via FNOL → status typically **FNOL** / **Open** / **Pending** (from `claim_status` table or default)
- **After Fraud Detection (run-fraud-detection):**
  - **Business Rule Validation-fail:** Reject (policy inactive / high fraud) OR any fraud rule failed
  - **Business Rule Validation-pass:** All fraud rules passed → claim is ready for Damage Detection
- **After Damage Detection (LLM):** Status set to **Recommendation shared** (AI assessment and claim amount stored)

---

## 4. Scenario A: New Claim Intake (FNOL)

- **Where:** **Claims → New Claim** (Claim Intake page)
- **Flow:**
  1. User fills: Claim ID, policy details, vehicle, incident (date, type, loss description, estimated amount), claimant, document flags (RC/DL/Photos/FIR), claim history
  2. Submit → `POST /save-fnol` with payload `{ fnol: { claim_id, policy, vehicle, incident, claimant, documents, history } }`
  3. Backend: creates/updates **fnol_claims** row; saves **documents.photos** as path strings in **fnol_damage_photos** (no file upload in current UI)
  4. User is redirected to **Claim Detail** for that claim ID
- **Outcome:** Claim exists with status FNOL/Open; appears in Claims list and Dashboard (recent claims)

---

## 5. Scenario B: Viewing & Listing Claims

- **Where:** **Claims** list page; **Dashboard** (recent claims)
- **Flow:**
  1. **Claims list:** `GET /fnol` → all FNOL claims; display complaint_id, customer, dates, status; filter by status (FNOL, Pending Damage Detection, Fraudulent, etc.); sort; open detail via link
  2. **Dashboard:** Uses mock stats + **Recent Claims** (mock or link to real claims); charts (Claims Trend, By Type); Fraud Alerts; Automation Stats
- **Claim status labels (UI):** e.g. FNOL, Pending, Business Rule Validation-pass, Business Rule Validation-fail, Recommendation shared — mapped to badges (processing, pending, rejected, approved)

---

## 6. Scenario C: Claim Detail – Open Claim (No Fraud Run Yet)

- **When:** Status is **Open / FNOL / Pending** (no fraud detection run)
- **Visible:**
  - Claim Details tab (incident info, description)
  - Documents tab (photos from `raw_response.documents.photos` or `damage_photos`; images from `API_MEDIA_URL` + path)
  - Sidebar: Customer, Policy, Vehicle
- **Actions:** Only **Fraud Detection** button is shown (no Damage Detection)
- **Hidden:** AI Assessment tab, Fraud Evaluation tab, overview cards (fraud/damage)

---

## 7. Scenario D: Running Fraud Detection

- **Where:** Claim Detail page (when claim is Open / not yet Business Rule Validation-fail)
- **Flow:**
  1. User clicks **Fraud Detection** → `POST /fnol/<complaint_id>/run-fraud-detection`
  2. Backend loads FNOL from DB, builds raw payload (including damage photo paths), runs **process_claim** logic:
     - **Product rule:** Policy status must be Active (else Reject)
     - **Fraud rules (from claim_rule_master):** Early Claim, Data missing, Vehicle Year Invalid, Missing Damage Photos
     - If **Reject** or any rule **failed** → status = **Business Rule Validation-fail**
     - If **all rules passed** → status = **Business Rule Validation-pass**
  3. Backend creates **claim_evaluation_response** row (damage_confidence, estimated_amount, decision, claim_status, fraud_rule_results, etc.) and updates **fnol_claims.claim_status**
  4. UI shows success modal and switches to **Fraud Evaluation** tab with rule pass/fail list
- **Outcome:** Claim status is either **Business Rule Validation-fail** (no Damage Detection) or **Business Rule Validation-pass** (Damage Detection button enabled)

---

## 8. Scenario E: Claim in “Pending Damage Detection” (Business Rule Validation-pass)

- **When:** Status is **Business Rule Validation-pass** (fraud rules passed; damage photos required for next step)
- **Visible:** **Damage Detection** button (primary/destructive style) instead of Fraud Detection
- **Flow:** User must run Damage Detection (Scenario F) to move claim forward; until then, only Claim Details, Documents, and Fraud Evaluation tabs are available

---

## 9. Scenario F: Running Damage Detection (AI Assessment)

- **Where:** Claim Detail page (when status is Business Rule Validation-pass and claim has photo paths)
- **Flow:**
  1. User clicks **Damage Detection** → frontend builds image URLs from `raw_response.documents.photos` or `damage_photos` (using `API_MEDIA_URL` for relative paths)
  2. `POST /llm/damage_assessment` with `{ claim_id, images: [url1, url2, ...] }`
  3. Backend (damage_detection_llm): fetches each image from URL, runs damage model + severity model per image; aggregates damages and severity
  4. Backend updates **claim_evaluation_response** (llm_damages, llm_severity, claim_amount from PricingConfig); sets **fnol_claims.claim_status** = **Recommendation shared**
  5. UI refreshes; **AI Assessment** and **Claim Evaluation** tabs appear with damage %, estimated amount, decision, LLM damages/severity
- **Outcome:** Claim reaches **Recommendation shared**; user sees AI damage assessment and claim evaluation (amount, threshold, decision, reason)

---

## 10. Scenario G: Claim Rejected (Business Rule Validation-fail)

- **When:** Fraud Detection returns Reject or any fraud rule failed
- **Visible:** No Damage Detection button; Fraud Evaluation tab shows failed rules
- **Outcome:** Claim stays in **Business Rule Validation-fail**; no AI damage step; user can only review details and fraud results

---

## 11. Scenario H: Fraud Detection Page (Dedicated View)

- **Where:** **Fraud Detection** in sidebar
- **Flow:** `GET /fraud-claims` → list of claims that have at least one **claim_evaluation_response** row
- **Display:** Summary cards (Under Review, Confirmed Fraud, Cleared); table with claim number, customer, risk score, reason, amount, status (under_review / confirmed / cleared). Status is derived from **fnol_claims.claim_status** (e.g. Fraudulent → confirmed; Closed/Auto Approved → cleared)
- **Use:** Central view for all claims that have been through fraud detection and their current fraud-related status

---

## 12. Scenario I: Damage Detection Page

- **Where:** **Damage Detection** in sidebar
- **Note:** Currently uses **mock data** (static list of damage cases). Not wired to live API list of “pending damage” or “recommendation shared” claims
- **Use:** Illustrative dashboard for damage estimation pending / in review / approved; can be extended to consume real claim list and link to Claim Detail

---

## 13. Scenario J: Reports & Analytics

- **Where:** **Reports** page
- **Content:** Time filter (7d, 30d, 3m, 6m, 1y); Export; summary cards; charts (e.g. claims volume, approvals/rejections, settlements); processing time (manual vs automated) — currently **mock/sample data**
- **Use:** Placeholder for real KPIs from backend (claim counts by status, amounts, automation rate)

---

## 14. Scenario K: Master Data (Admin/Config)

- **Where:** **Administration → Master Data** (Damage Configuration, Claim Configuration, Fraud Rules, Price Config)
- **Sections:**
  - **Damage types:** CRUD on **damage_code_master** (damage_type, severity_percentage) — used in rule-based damage confidence
  - **Claim types / Thresholds:** CRUD on **claim_type_master** (claim_type_name, risk_percentage) — used for threshold and claim type bucket (SIMPLE/MEDIUM/COMPLEX)
  - **Fraud rules:** CRUD on **claim_rule_master** (rule_type, rule_group, rule_description, rule_expression) — e.g. Early Claim, Data missing, Missing Damage Photos
  - **Pricing config:** CRUD on **pricing_config** (claim_base_amount, claim_rate_per_damage, severity multipliers) — used for LLM claim amount estimation
- **Permissions:** damage_config, claim_config, fraud_rules, price_config (view/update/delete); Admin sees all

---

## 15. Scenario L: User & Role Management (Admin)

- **Where:** **Administration → Users, Roles, Role Permissions**
- **Users:** List, Create, Edit, Change Role, Reset Password, Activate/Deactivate (admin only); **Roles:** manage groups; **Role Permissions:** assign permissions to roles
- **Backend:** Django User + Group; Token auth; permissions stored and returned via `/users/me` (or similar) for UI permission checks
- **Use:** Control who can access Dashboard, Claims, Fraud, Damage, Reports, and each Master Data section

---

## 16. Scenario M: Images / Documents in Claims

- **Saving:** **save-fnol** only stores **path strings** in **fnol_damage_photos** (e.g. `vehicle_damage/CLM_D001_1.JPEG`). No file upload endpoint in current flow; images are assumed to exist under **MEDIA_ROOT** (e.g. `media/vehicle_damage/`)
- **Display:** Claim Detail → Documents tab: photos from `documents.photos` or `damage_photos`; each image URL = `VITE_API_MEDIA_URL` + path
- **Damage Detection:** Same photo paths turned into full URLs and sent to `/llm/damage_assessment`; backend fetches images from those URLs for inference

---

## 17. Scenario N: Dashboard at a Glance

- **Metrics:** Total Claims, Pending Review, Approved Today, Fraud Flagged, Settlement Value (mock)
- **Charts:** Claims trend over time; claims by type (mock)
- **Widgets:** Recent Claims table (mock or link to real); Automation Stats; Fraud Alerts
- **Use:** High-level overview; can be wired to real APIs for live metrics

---

## 18. Quick Reference: Main API Endpoints

| Action              | Method | Endpoint                                      |
|---------------------|--------|-----------------------------------------------|
| Login               | POST   | /api/login                                    |
| List claims         | GET    | /api/fnol                                     |
| Get one claim       | GET    | /api/fnol/<id>                                |
| Save FNOL           | POST   | /api/save-fnol                                |
| Process claim (no save) | POST | /api/process-claim                         |
| Run fraud detection | POST   | /api/fnol/<id>/run-fraud-detection            |
| Get claim evaluation| GET    | /api/fnol/<id>/evaluation                     |
| Damage assessment   | POST   | /api/llm/damage_assessment                    |
| Fraud claims list   | GET    | /api/fraud-claims                             |
| Master data         | GET/POST/PATCH/DELETE | /api/masters/... (damage-codes, claim-types, claim-rules, pricing-config) |
| Users / roles       | Various| /api/users/..., roles, permissions            |

---

## 19. Summary: End-to-End Happy Path

1. **Login** → access app with role-based menu  
2. **Create claim** (Claim Intake) → FNOL saved; status Open/FNOL  
3. **Open claim** from Claims list → see Details + Documents  
4. **Run Fraud Detection** → Business Rule Validation-pass or -fail  
5. If **pass** → **Run Damage Detection** → AI damages + severity + claim amount; status **Recommendation shared**  
6. **View** Fraud Detection page for all validated claims; **View** Claim Detail for AI Assessment and Claim Evaluation  
7. **Configure** rules and pricing via Master Data; **Manage** users/roles via Administration  

Use this document to build slides: one slide per scenario or group related scenarios (e.g. “Claim lifecycle”, “Fraud & damage flows”, “Admin & configuration”).
