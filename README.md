# 🚗 Automated Vehicle Insurance Claims Processing System  
**Phase 1 – AI-Enabled Simple Claims Automation**

---

## 📌 Overview

This project is an intelligent vehicle insurance claims automation platform designed to process simple motor insurance claims with minimal human intervention.

The system acts as an evaluation and automation layer integrated with a core insurance system (e.g., Guidewire) and focuses on:

- Faster claim settlements (24–48 hours)
- Reduced manual workload
- Consistent rule-based decisioning
- AI-driven damage and fraud detection

---

## 🎯 Objectives

- Automate high-volume, low-value motor insurance claims  
- Classify claims into Simple vs Complex  
- Use AI + Rules Engine for:
  - Damage assessment  
  - Fraud detection  
  - Eligibility validation  
- Enable Straight Through Processing (STP) for eligible claims  

---

## 👥 User Roles

| Role | Responsibilities |
|------|------------------|
| Admin | Manage users, roles, master data, automation rules, reports, audit logs |
| Supervisor | Review escalated claims, approve/reject exceptions, override valuations |
| Claims Adjuster | Validate FNOL, review images, handle non-auto-approved claims |

All user activities are audit logged.

---

## 🧩 Core Modules

### 1️⃣ User Management
- User creation and activation/deactivation  
- Email-based login  
- Role assignment  
- Password reset on first login  
- Modern, branded UI  

### 2️⃣ Master Data & Rules Configuration
Admin-configurable:
- Damage types (dent, scratch, glass, structural, etc.)  
- Claim value thresholds  
- OIC excess rules  
- Repair cost benchmarks  
- Fraud rule parameters  

⚠️ All rules must be configurable (not hard-coded).

### 3️⃣ FNOL (First Notice of Loss)
- FNOL data received from Guidewire  
- Capture incident details, location & time, vehicle info  
- Minimum 4 damage photos  
- Auto-generate claim ID  

### 4️⃣ Validation Engine
System validates:
- Policy status (active, premium paid)  
- Vehicle-policy match  
- Coverage eligibility  
- Duplicate claims  
- License & document verification  

### 5️⃣ AI Image Assessment
- Damage detection from photos  
- Pre-existing damage detection  
- Number plate verification  
- AI confidence threshold (≥ 85%)  

### 6️⃣ Fraud Detection
Fraud risk scoring based on:
- Early claims after policy start  
- Location mismatch  
- Repeat garage usage  
- Blacklisted entities  

Output: Fraud risk score + explanation.

### 7️⃣ Claim Classification Engine

| Type | Description |
|------|-------------|
| Simple (STP) | Auto-process eligible claims |
| Assisted Processing | Minor exception, manual review |
| Rejection | Hard rule failure or confirmed fraud |

### 8️⃣ Automated Processing (Simple Claims)
- Auto damage evaluation  
- Excess calculation  
- Settlement approval  
- Send results to Guidewire  

### 9️⃣ Reporting & Dashboard
KPIs include total claims, approvals, fraud flags, automation rate, processing time, and settlement amounts.  
Export supported in Excel / CSV.

---

## 🏗 Technical Stack

Frontend: React.js, Material UI  
Backend: Python (Django), REST APIs, JWT Auth  
Database: MySQL  
Infrastructure: AWS, Docker, CI/CD Pipeline  

---

## 🔐 Security & Non-Functional Requirements

- Role-Based Access Control (RBAC)  
- OAuth2 / JWT authentication  
- Full audit logging  
- Response time < 6 seconds  
- Support ≥ 50 concurrent users  
- Encrypted data in transit & at rest  
- Regular backups  

---

## 📦 Phase 1 Scope

### In Scope
- Simple motor insurance claims  
- AI-based damage and fraud evaluation  
- Rule-based automation  
- Dashboard & reporting  

### Out of Scope
- Third-party injury claims  
- Legal workflows  
- Total loss & salvage cases  
- Bodily injury claims  

---

## 🔄 System Flow (High Level)

1. FNOL received  
2. Policy & data validation  
3. AI image assessment  
4. Fraud scoring  
5. Rule engine classification  
6. STP → Auto settlement or escalation  

---

## 📁 Deliverables

- Source Code  
- Database Design  
- API Specifications  
- UI Wireframes  
- Test Reports  
- Deployment Guide  
- Admin User Manual  

---

Author: BigTapp  
Project Type: Enterprise Insurance Automation Platform
