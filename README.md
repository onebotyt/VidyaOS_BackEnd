<div align="center">
  <h1>🎓 VidyaOS — Institutional Campus Operating System</h1>
  <p><strong>Private Backend REST API Server</strong></p>
  <p>
    <img src="https://img.shields.io/badge/Node.js-20%2B-339933?style=flat-square&logo=node.js" />
    <img src="https://img.shields.io/badge/Express-4.x-000000?style=flat-square&logo=express" />
    <img src="https://img.shields.io/badge/MySQL-8.x-4479A1?style=flat-square&logo=mysql" />
    <img src="https://img.shields.io/badge/SQLite-local_dev-003B57?style=flat-square&logo=sqlite" />
    <img src="https://img.shields.io/badge/Docker-ready-2496ED?style=flat-square&logo=docker" />
  </p>
</div>

---

## 📖 Table of Contents

1. [What is VidyaOS?](#what-is-vidyaos)
2. [Architecture Overview](#architecture-overview)
3. [Quick Start — Local Development](#quick-start--local-development)
4. [MySQL Production Setup](#mysql-production-setup)
5. [Environment Variables Reference](#environment-variables-reference)
6. [API Reference](#api-reference)
7. [Deployment Guide](#deployment-guide)
   - [Render.com (Cloud)](#-rendercom-cloud-deployment)
   - [Docker / VPS / cPanel](#-docker--vps--cpanel-server-room)
   - [GitOps Auto-Deploy](#-gitops-auto-deploy-cicd)
8. [Admin Management Guide](#admin-management-guide)
9. [Database Management](#database-management)
10. [WhatsApp Gateway (Self-Hosted Bot)](#whatsapp-gateway-self-hosted-bot)
11. [Automated Test Suites](#automated-test-suites)
12. [Default Demo Accounts](#default-demo-accounts)

---

## What is VidyaOS?

**VidyaOS** is a production-grade, full-stack institutional campus management system built for polytechnic colleges following the **IRDT Uttarakhand** curriculum framework. It replaces fragmented Excel/paper workflows with a unified digital system.

| Module | Description |
| :--- | :--- |
| **VidyaOS Core** | Academic structure, departments (CE, IT, ME, EE, ECE, PHARM), HOD hierarchy |
| **VidyaOS Register** | Day-wise attendance matrix (1–31 ledger), coursework & assignments, marksheets |
| **VidyaOS Connect** | Self-hosted WhatsApp Web Bot gateway for OTPs, registration flows & notifications |
| **VidyaOS BioGate** | ESP32 biometric terminals & Live QR/PIN roll-call studio |

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                         VidyaOS Architecture                         │
├─────────────────────────┬────────────────────────────────────────────┤
│  Frontend (Decoupled)   │  Backend (This Repo — Private)             │
│  github: VidyaOS        │  github: VidyaOS_BackEnd                   │
│  Hosting: Vercel CDN    │  Hosting: Render.com OR Docker/VPS         │
│                         │                                            │
│  HTML / CSS / JS        │  Node.js 20 + Express 4                    │
│  dev-server.js proxy    │  MySQL 8.x (Production)                    │
│  No build step needed   │  SQLite (Local Dev, zero-setup)            │
│                         │  JWT Auth (Access + Refresh tokens)        │
│                         │  WhatsApp Web Bot (whatsapp-web.js)        │
│                         │  ESP32 IoT Biometric Terminal Integration  │
└─────────────────────────┴────────────────────────────────────────────┘
```

**Base URL:** `http://localhost:3000/api/v1` (local) or `https://vidyaos-backend.onrender.com/api/v1` (cloud)

---

## Quick Start — Local Development

### Prerequisites
- [Node.js](https://nodejs.org/) v20 or higher (`node --version`)
- Git

### 1. Clone the Private Repository

```bash
git clone https://github.com/onebotyt/VidyaOS_BackEnd.git
cd VidyaOS_BackEnd
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment

```bash
# Copy example env file
cp .env.example .env
```

For local development, the defaults work out of the box — **no MySQL needed**. SQLite is used automatically:
```env
DB_CLIENT=sqlite
```

### 4. Start the Server

```bash
# Development (auto-restart on file changes)
npm run dev

# OR Production
npm start
```

Server starts on: **`http://localhost:3000`**

The frontend is served from `../frontend/` automatically when co-located.

```
✓ VidyaOS Institutional REST API — ONLINE
✓ SQLite Local Database connected and ready
✓ Academic Session automated & active: [2026-27 (Winter)]
✓ Listening on port 3000
```

---

## MySQL Production Setup

For deployment on cPanel, Render.com, VPS, or Docker, use **MySQL 8.x**.

### Step 1: Create the MySQL Database

In your MySQL client, cPanel phpMyAdmin, or command line:

```sql
CREATE DATABASE college_attendance CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'vidyaos_user'@'%' IDENTIFIED BY 'YourStrongPassword123!';
GRANT ALL PRIVILEGES ON college_attendance.* TO 'vidyaos_user'@'%';
FLUSH PRIVILEGES;
```

### Step 2: Import Production Schema + Seed Data

The file `database/cpanel_production_mysql.sql` contains the complete production-ready schema with:
- All tables (departments, students, faculty, registers, attendance, etc.)
- 6 canonical department records (CE, IT, ME, EE, ECE, PHARM)
- System Administrator account (`admin` / `Admin@123`)
- Initial academic year record (`2026-27 (Winter)`)

```bash
# Via command line:
mysql -u vidyaos_user -p college_attendance < database/cpanel_production_mysql.sql

# Via cPanel phpMyAdmin:
# 1. Open phpMyAdmin → Select your database
# 2. Click "Import" tab → Choose file: database/cpanel_production_mysql.sql
# 3. Click "Go"
```

### Step 3: Set Environment Variables

```env
# In your .env file (or Render / Docker environment variables):
DB_CLIENT=mysql
DB_HOST=your-mysql-host.com
DB_PORT=3306
DB_USER=vidyaos_user
DB_PASSWORD=YourStrongPassword123!
DB_NAME=college_attendance
DB_CONNECTION_LIMIT=10
JWT_ACCESS_SECRET=generate-a-strong-random-secret-min-64-chars
JWT_REFRESH_SECRET=generate-another-strong-random-secret-min-64-chars
```

> **Generate secure secrets:**
> ```bash
> node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
> ```

### Step 4: Start Server

```bash
NODE_ENV=production npm start
```

---

## Environment Variables Reference

| Variable | Default | Required | Description |
| :--- | :--- | :--- | :--- |
| `PORT` | `3000` | No | HTTP server port |
| `NODE_ENV` | `development` | No | `development` or `production` |
| `DB_CLIENT` | `sqlite` | **Yes** | `sqlite` (local dev) or `mysql` (production) |
| `DB_HOST` | `localhost` | MySQL only | MySQL server hostname |
| `DB_PORT` | `3306` | MySQL only | MySQL port |
| `DB_USER` | `root` | MySQL only | MySQL username |
| `DB_PASSWORD` | _(empty)_ | MySQL only | MySQL password |
| `DB_NAME` | `college_attendance` | MySQL only | MySQL database name |
| `DB_CONNECTION_LIMIT` | `10` | No | MySQL connection pool size |
| `SQLITE_FILE` | `college_attendance.sqlite` | SQLite only | Relative or absolute path to SQLite file |
| `JWT_ACCESS_SECRET` | _(none)_ | **Yes** | JWT signing secret for access tokens |
| `JWT_REFRESH_SECRET` | _(none)_ | **Yes** | JWT signing secret for refresh tokens |
| `JWT_ACCESS_EXPIRY` | `15m` | No | Access token lifetime |
| `JWT_REFRESH_EXPIRY` | `7d` | No | Refresh token lifetime |
| `UPLOADS_DIR` | `uploads/` | No | Directory for assignment/submission file uploads |
| `WHATSAPP_SESSION_DIR` | `whatsapp_session/` | No | WhatsApp Web Bot session storage directory |
| `PUPPETEER_EXECUTABLE_PATH` | _(auto-detect)_ | No | Path to Chromium binary (auto-detected from Playwright; or `/usr/bin/chromium` on Linux/Docker) |
| `DEFAULT_ATTENDANCE_THRESHOLD` | `75` | No | Minimum attendance percentage for defaulter detection |
| `AUTO_CLOSE_CHECK_INTERVAL_SECONDS` | `60` | No | Interval for auto-closing expired attendance sessions |

---

## API Reference

All endpoints are under `/api/v1`. **Authentication** uses Bearer JWT tokens — include `Authorization: Bearer <token>` in headers for protected routes.

### 🔐 Authentication

| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/auth/login` | Public | Login (returns access token + refresh token) |
| `POST` | `/auth/refresh` | Public | Refresh expired access token |
| `POST` | `/auth/logout` | User | Revoke refresh token |
| `GET` | `/auth/me` | User | Get current user profile |
| `POST` | `/auth/faculty/register` | Public | Faculty self-registration (OTP verification required) |
| `POST` | `/auth/student/register` | Public | Student self-registration (OTP verification required) |
| `POST` | `/auth/otp/send` | Public | Send OTP via WhatsApp / SMS |
| `POST` | `/auth/otp/verify` | Public | Verify submitted OTP |
| `GET` | `/auth/google/url` | Public | Generate official Google OAuth login URL |
| `GET` | `/auth/google/callback` | Public | Google OAuth callback handler |

**Login Request:**
```json
POST /api/v1/auth/login
{
  "username": "admin",
  "password": "Admin@123"
}
```

**Login Response:**
```json
{
  "success": true,
  "data": {
    "user": { "id": 1, "username": "admin", "roles": ["SYSTEM_ADMIN"] },
    "access_token": "eyJ...",
    "refresh_token": "eyJ..."
  }
}
```

---

### 🏛️ Admin Endpoints

> **Requires**: `SYSTEM_ADMIN` role

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/admin/dashboard` | System-wide KPI metrics (users, departments, students) |
| `GET` | `/admin/users` | List all users with roles |
| `POST` | `/admin/users` | Create new user (manual) |
| `PUT` | `/admin/users/:id` | Update user details |
| `DELETE` | `/admin/users/:id` | Deactivate user |
| `GET` | `/admin/departments` | List all departments |
| `POST` | `/admin/departments` | Add custom department |
| `DELETE` | `/admin/departments/:id` | Remove department (hardcoded depts protected) |
| `GET` | `/admin/session/status` | Current academic session status |
| `GET` | `/admin/audit-logs` | Institutional audit trail |
| `GET` | `/admin/whatsapp/status` | WhatsApp Bot connection status |
| `POST` | `/admin/whatsapp/initialize` | Launch WhatsApp Bot (generates QR) |
| `POST` | `/admin/whatsapp/test-send` | Send test WhatsApp message |
| `DELETE` | `/admin/whatsapp/disconnect` | Disconnect WhatsApp session |
| `GET` | `/admin/whatsapp/qr` | Get current QR code image |
| `GET` | `/admin/faculty/registrations` | Pending faculty registration requests |
| `POST` | `/admin/faculty/registrations/:id/approve` | Approve faculty account |
| `DELETE` | `/admin/faculty/registrations/:id/reject` | Reject faculty registration |

---

### 👨‍🏫 HOD Endpoints

> **Requires**: `HOD` role for mutating operations

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/hod/dashboard` | HOD department summary |
| `GET` | `/hod/teachers` | List teachers in HOD's department |
| `POST` | `/hod/teachers` | Add teacher to department (HOD only) |
| `DELETE` | `/hod/teachers/:id` | Remove teacher from department |
| `GET` | `/hod/subjects` | List subjects for HOD's department |
| `POST` | `/hod/subjects` | Create subject |
| `PUT` | `/hod/subjects/:id` | Update subject |
| `DELETE` | `/hod/subjects/:id` | Remove subject |
| `POST` | `/hod/assignments/subject-teacher` | Assign teacher to subject |
| `DELETE` | `/hod/assignments/subject-teacher/:id` | Remove teacher from subject |
| `GET` | `/hod/students` | Student roster for HOD's department |
| `GET` | `/hod/settings` | Department configuration |
| `PUT` | `/hod/settings` | Update department settings |

---

### 📒 Faculty / Registers Endpoints

> **Requires**: `TEACHER` role with appropriate subject assignments

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/faculty/registers` | List teacher's attendance registers |
| `GET` | `/faculty/registers/:id` | Get register detail (matrix data) |
| `GET` | `/faculty/cohorts` | Teacher's assigned cohort groups |
| `GET` | `/faculty/subjects` | Teacher's assigned subjects |
| `POST` | `/attendance/sessions` | Create new attendance session (DRAFT) |
| `PUT` | `/attendance/sessions/:id/open` | Open session (start roll-call) |
| `PUT` | `/attendance/sessions/:id/close` | Close session and save records |
| `GET` | `/attendance/sessions/:id/pin` | Generate 6-digit session PIN |
| `POST` | `/attendance/sessions/:id/checkin` | Student PIN check-in claim |
| `GET` | `/attendance/sessions/:id/claims` | Pending check-in claims queue |
| `PUT` | `/attendance/sessions/:id/claims/:claimId` | Approve/reject claim |
| `POST` | `/attendance/sessions/:id/qr` | Generate/refresh QR token |
| `POST` | `/attendance/matrix/mark` | Mark attendance on the 1-31 matrix |
| `GET` | `/assignments` | Scoped coursework list (`?subject_id=&register_id=`) |
| `POST` | `/assignments` | Create assignment |
| `GET` | `/exams` | Scoped class tests list (`?subject_id=&register_id=`) |
| `POST` | `/exams` | Schedule class test |
| `GET` | `/exams/:id/scores` | Marksheet for class test |
| `PUT` | `/exams/:id/scores` | Save batch marks |

---

### 🎓 Student Endpoints

> **Requires**: `STUDENT` role

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/students/profile` | Student profile & enrollment details |
| `GET` | `/students/attendance` | Attendance summary with predictor |
| `GET` | `/students/subjects` | Enrolled subjects with attendance % |
| `GET` | `/students/notifications` | In-app notification feed |
| `PUT` | `/students/notifications/:id/read` | Mark notification as read |

---

### 🔔 System Endpoints

| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/health` | Public | Server health check |
| `GET` | `/departments` | Public | List active departments (for registration forms) |
| `GET` | `/notifications` | User | In-app notification feed |
| `GET` | `/notifications/unread-count` | User | Unread notification badge count |
| `GET` | `/reports/defaulters` | Teacher/HOD | Attendance defaulter report |

---

## Deployment Guide

### ☁️ Render.com Cloud Deployment

1. Push this repository to GitHub as **private** repo (`VidyaOS_BackEnd`).
2. Go to [render.com](https://render.com) → **New Web Service** → Connect to `VidyaOS_BackEnd`.
3. Configure:
   - **Root Directory**: `./` (or `backend/` if in monorepo)
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
4. Set all **Environment Variables** in the Render dashboard (see table above).
5. For **MySQL**, create a managed MySQL service (PlanetScale, Railway, or Aiven free tier) and set the `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` variables.

> **Free Tier Note:** Render free web services sleep after 15 minutes of inactivity. Use the paid ($7/mo) plan for production.

---

### 🐳 Docker / VPS / cPanel Server Room

**Requirements:** Docker + Docker Compose installed on server.

#### First-Time Setup

```bash
# 1. Clone private repo to server (requires SSH deploy key — see below)
git clone git@github.com:onebotyt/VidyaOS_BackEnd.git /opt/vidyaos
cd /opt/vidyaos

# 2. Create your environment file
cp .env.example .env
nano .env  # Set DB_CLIENT=mysql and MySQL credentials

# 3. Start in background
docker compose up -d --build

# 4. Import MySQL schema (first time only)
docker exec -i $(docker ps -qf "name=vidyaos") mysql -u vidyaos_user -p college_attendance < database/cpanel_production_mysql.sql
```

#### What Persists (Never Lost on Container Rebuild)

```
./server-data/db/          ← SQLite database file (if using SQLite mode)
./server-data/uploads/     ← Assignment & submission file uploads
./server-data/whatsapp-session/  ← WhatsApp Web Bot linked phone credentials
```

#### Day-to-Day Update

```bash
cd /opt/vidyaos
./deploy/update.sh   # Linux/VPS
# OR
deploy\update.bat    # Windows Server
```

---

### 🔄 GitOps Auto-Deploy (CI/CD)

The file `.github/workflows/deploy.yml` automatically deploys to your server on every `git push origin main`.

**Setup (one-time):**
1. Generate an SSH key on your server: `ssh-keygen -t ed25519 -f ~/.ssh/vidyaos_deploy`
2. Add the public key to your server's `~/.ssh/authorized_keys`
3. Add the private key to GitHub: **Repo → Settings → Secrets → Actions** with names:
   - `SERVER_HOST` — Your server IP or domain
   - `SERVER_USER` — SSH login username (e.g. `root`)
   - `SERVER_SSH_KEY` — Contents of `~/.ssh/vidyaos_deploy` (private key)

From now on, `git push origin main` auto-deploys the server in ~30 seconds.

---

### 🔑 Private Repo — SSH Deploy Key Setup

Since `VidyaOS_BackEnd` is private, your server needs SSH credentials to clone:

```bash
# 1. On the server:
ssh-keygen -t ed25519 -C "vidyaos-server" -f ~/.ssh/vidyaos_deploy_key

# 2. Print public key and add to GitHub:
cat ~/.ssh/vidyaos_deploy_key.pub
# GitHub → Repo → Settings → Deploy Keys → Add Deploy Key (read-only)

# 3. Configure SSH client:
echo 'Host github.com
  IdentityFile ~/.ssh/vidyaos_deploy_key' >> ~/.ssh/config

# 4. Test it:
git clone git@github.com:onebotyt/VidyaOS_BackEnd.git
```

---

## Admin Management Guide

### 🏛️ First-Login Setup

1. Open `http://your-server:3000` (or Render URL)
2. Login with: **admin / Admin@123** → Change password immediately
3. Go to **Academic Structure** → Verify 6 departments are seeded
4. Navigate to **HOD Teachers** → Assign HODs to departments
5. Faculty self-register via `/login/faculty.html` or admin creates them manually

### 👥 User Role Hierarchy

```
SYSTEM_ADMIN
  └── HOD (per department)
       └── TEACHER (with class_teacher flag)
            └── STUDENT
```

### 🔑 Resetting a Forgotten Admin Password

```bash
# Using the Node.js REPL directly:
node -e "
const bcrypt = require('bcrypt');
bcrypt.hash('NewPassword@123', 12).then(h => console.log(h));
"
# Then run in your MySQL:
UPDATE users SET password_hash = '<output from above>' WHERE username = 'admin';
```

---

## Database Management

### Schema Files

| File | Purpose |
| :--- | :--- |
| `database/cpanel_production_mysql.sql` | **Production MySQL** — Full schema + seed (use this for deployment) |
| `database/sqlite/schema.sql` | SQLite schema for local dev (auto-loaded on first boot) |
| `database/sqlite/seed.sql` | Local development seed data |

### Running Migrations

```bash
# Apply pending migrations to production MySQL:
mysql -u vidyaos_user -p college_attendance < database/migrations/YYYY-MM-DD_description.sql
```

### Backup & Restore (MySQL)

```bash
# Backup
mysqldump -u vidyaos_user -p college_attendance > backup_$(date +%F).sql

# Restore
mysql -u vidyaos_user -p college_attendance < backup_2026-10-01.sql
```

---

## WhatsApp Gateway (Self-Hosted Bot)

VidyaOS includes a **zero-cost** WhatsApp integration using your college's own phone number.

### How It Works
1. Admin opens `/admin/whatsapp-gateway.html`
2. Clicks **"🚀 Link Bot (Generate QR)"**
3. Server launches headless Chromium → shows QR code
4. Admin scans QR with college WhatsApp: **WhatsApp → Linked Devices → Link a Device**
5. Bot status turns **🟢 Connected** — OTP delivery is now live

### Environment Variables for Deployment

```env
WHATSAPP_SESSION_DIR=/app/whatsapp_session
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium   # Linux/Docker only
```

### Fallback Behavior
If the bot is offline/unlinked, the system automatically falls back to direct `wa.me` links so student registration and OTP flows **never fail**.

---

## Automated Test Suites

Run from the project root:

```bash
# Core test suites
node backend/scripts/test-api-flows.js               # 25/25 (All auth & API flows)
node backend/scripts/test-theme-support.js           # 93/93 (Theme token integrity)
node backend/scripts/test-register-consolidation.js  # 46/46 (Attendance register flows)
node backend/scripts/test-rbac-and-structure.js      # 30/30 (RBAC guards & redirects)
node backend/scripts/test-whatsapp-bot-integration.js # 16/16 (WhatsApp gateway)
node backend/scripts/test-student-self-registration.js # 29/29 (Student reg & approval)
node backend/scripts/test-faculty-registration-flow.js # 89/89 (Faculty 3-tier approval)
node backend/scripts/test-term-automation.js         # 52/52 (Academic session engine)
```

---

## Default Demo Accounts

> **All accounts use the password:** `Admin@123` (admin) or `Password@123` (faculty & students)

| Role | Username / Email | Password | Console |
| :--- | :--- | :--- | :--- |
| **System Admin** | `admin` | `Admin@123` | `/admin/academic-structure.html` |
| **HOD (IT)** | `hod.it@college.edu` | `Password@123` | `/faculty/hod-teachers.html` |
| **HOD (CE)** | `hod.ce@college.edu` | `Password@123` | `/faculty/hod-teachers.html` |
| **Faculty** | `prof.sharma@college.edu` | `Password@123` | `/faculty/registers.html` |
| **Student** | `student.it01@college.edu` | `Password@123` | `/student/attendance.html` |

> ⚠️ **Change all default passwords immediately after production deployment.**

---

## Tech Stack

| Component | Technology |
| :--- | :--- |
| Runtime | Node.js 20+ |
| Web Framework | Express 4.x |
| Production DB | MySQL 8.x (mysql2/promise) |
| Local Dev DB | SQLite (node:sqlite — built-in, zero install) |
| Authentication | JWT (Access + Refresh token rotation) |
| File Uploads | Multer (20 MB limit, document/image types) |
| WhatsApp Bot | whatsapp-web.js + LocalAuth + Chromium |
| Rate Limiting | express-rate-limit |
| Security | helmet, bcrypt, express-validator |
| Scheduling | Autonomous session engine (hourly/midnight cron) |
| Logging | Custom structured logger |

---

<div align="center">
  <p>© 2026 VidyaOS — Institutional Campus Operating System</p>
  <p><em>Built for Uttarakhand Polytechnic Colleges — IRDT Curriculum Framework</em></p>
</div>
