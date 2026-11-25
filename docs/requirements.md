# WorkSphere — Project Scope, Roles & Requirements (`WS-001`, `WS-002`)

## 1. Project Overview & Scope (`WS-001`)

**WorkSphere** คือแพลตฟอร์มบริหารโปรเจกต์และทำงานร่วมกันแบบ Multi-tenant SaaS (ผสมจุดเด่นของการจัดการ Task/Dependency แบบ Jira และกระดาน Kanban แบบ Trello) โดยพัฒนา Backend, Authentication, RBAC, Realtime และ Background Workers ด้วยตัวเองทั้งหมดบนสถาปัตยกรรม Next.js (TypeScript)

### 1.1 In-Scope (ขอบเขตที่พัฒนา)
1. **Authentication & Security**: สมัครสมาชิก, ยืนยันอีเมล, เข้าสู่ระบบ, ออกจากระบบ, ต่ออายุเซสชัน (Refresh Token Rotation + Reuse Detection), ลืม/ตั้งรหัสผ่านใหม่, Rate Limiting
2. **Multi-tenancy (`Organization` → `Workspace` → `Project`)**: สร้างหลายองค์กร, แยกข้อมูลระดับฐานข้อมูล (`orgId` isolation), จัดการ Workspace ตามแผนก/ทีม, เชิญสมาชิกผ่านลิงก์พร้อมวันหมดอายุ
3. **Role-Based Access Control (RBAC)**: บังคับใช้สิทธิ์ฝั่ง Backend ครบ 4 บทบาทหลัก (`System Admin`, `Organization Owner`, `Project Manager`, `Member`)
4. **Project & Task Engine**: จัดการ Project (สร้าง/แก้ไข/Archive), Task และ Subtask, รหัสงานอัตโนมัติ (เช่น `ENG-42`), ผู้รับผิดชอบ, ความสำคัญ, วันครบกำหนด, Tags/Labels
5. **Kanban Board**: ลากวางเปลี่ยนคอลัมน์และจัดลำดับการ์ดด้วย Fractional Indexing (รีเฟรชแล้วลำดับคงเดิม)
6. **Task Dependency Engine**: กำหนดความสัมพันธ์ `blocks` / `blocked_by`, ตรวจจับวงจรปิด (Cycle Detection) และบล็อกการปิดงานหากงานต้นทางยังไม่เสร็จ
7. **Collaboration & Attachments**: แสดงความคิดเห็น (`@mention`), แนบไฟล์ผ่าน S3-compatible / Local Storage Adapter, บันทึก Activity / Audit Log
8. **Realtime & Notifications**: อัปเดตบอร์ด/คอมเมนต์ทันทีผ่าน Socket.IO (แยกห้องตามสิทธิ์) และศูนย์แจ้งเตือน (Notification Center)
9. **Advanced Backend & Analytics**: Optimistic Locking (`version`), DB Transactions, Redis Caching, BullMQ Background Jobs, Search/Filter/Cursor Pagination และหน้า Dashboard สรุปผล

### 1.2 Out-of-Scope (นอกเหนือขอบเขตเพื่อคุมเวลา 10 สัปดาห์)
- ระบบตัดบัตรเครดิต/Billing จริง (จำลองระดับแผนการใช้งานเบื้องต้นได้หากต้องการ)
- Native Mobile App (รองรับผ่าน Responsive Web UI)
- Gantt Chart เชิงลึก หรือ Time-tracking รายวินาที
- SSO ภายนอก (SAML / OAuth Google/GitHub) ในเฟสหลัก — เน้นสร้างระบบ Auth ด้วยตัวเองเป็นหลัก

---

## 2. User Roles & Permission Matrix (`WS-001`)

ระบบแบ่งสิทธิ์เป็น **4 บทบาทหลัก** ตามระดับของทรัพยากร โดย **ห้ามใช้การซ่อนปุ่มบน Frontend แทนการตรวจสิทธิ์ที่ Backend เด็ดขาด**

| บทบาท (Role) | ขอบเขต (Scope) | หน้าที่และสิทธิ์หลัก |
|---|---|---|
| **System Admin** (`SYSTEM_ADMIN`) | ทั้งแพลตฟอร์ม | ดูสถิติระบบ, จัดการสถานะองค์กร/ผู้ใช้ (ระงับ/ปลดระงับ), ดู System Audit Log *(ไม่เข้าถึงเนื้อหา Task ภายในองค์กรโดยพลการ)* |
| **Organization Owner** (`ORG_OWNER`) | ภายใน Organization | จัดการตั้งค่าองค์กร, ลบองค์กร, สร้าง/ลบ Workspace, เชิญ/ถอดถอนสมาชิก, กำหนดสิทธิ์, มีสิทธิ์เทียบเท่า Project Manager ในทุกโปรเจกต์ขององค์กร |
| **Project Manager** (`PROJECT_MANAGER`) | ภายใน Project / Workspace | สร้าง/แก้ไข/Archive โปรเจกต์, จัดการสมาชิกโปรเจกต์, ตั้งค่าคอลัมน์ Kanban, สร้าง/มอบหมาย/ลบ Task ทุกใบ, จัดการ Dependency |
| **Member** (`MEMBER`) | ภายใน Project ที่สังกัด | ดูโปรเจกต์และบอร์ด, สร้าง Task/Subtask, อัปเดตสถานะ/ลากวางงาน, แก้ไข/ลบเฉพาะงานหรือคอมเมนต์ของตนเอง, แสดงความคิดเห็นและแนบไฟล์ |

> **หมายเหตุการขยายสิทธิ์:** ในระดับองค์กรรองรับ `ORG_ADMIN` (ช่วย Owner เชิญคน/สร้าง Workspace แต่ลบองค์กรหรือปลด Owner ไม่ได้) และในระดับโปรเจกต์รองรับ `VIEWER` (ดูและคอมเมนต์ได้อย่างเดียว) เพื่อให้ยืดหยุ่นต่อการใช้งานจริง

### 2.1 Detailed Permission Matrix

| Action / Permission | System Admin | Org Owner | Project Manager | Member |
|---|:-:|:-:|:-:|:-:|
| จัดการตั้งค่าระบบ / ระงับ Tenant (`platform:manage`) | ✅ | ❌ | ❌ | ❌ |
| แก้ไขตั้งค่าองค์กร (`org:update`) | ❌ | ✅ | ❌ | ❌ |
| ลบองค์กร / โอนความเป็นเจ้าของ (`org:delete`) | ❌ | ✅ | ❌ | ❌ |
| เชิญสมาชิก / เปลี่ยน Role ในองค์กร (`org:manage_members`) | ❌ | ✅ | ❌ | ❌ |
| สร้าง / แก้ไข / ลบ Workspace (`workspace:manage`) | ❌ | ✅ | ❌ | ❌ |
| สร้าง Project ใน Workspace (`project:create`) | ❌ | ✅ | ✅ *(ใน Workspace ตน)* | ❌ |
| แก้ไข / Archive Project (`project:update`) | ❌ | ✅ | ✅ | ❌ |
| เพิ่ม / ถอดสมาชิกใน Project (`project:manage_members`) | ❌ | ✅ | ✅ | ❌ |
| จัดการคอลัมน์ Kanban (`board:manage_columns`) | ❌ | ✅ | ✅ | ❌ |
| ดู Project, Board, Tasks (`project:read`) | ❌ | ✅ | ✅ | ✅ *(เฉพาะที่เป็นสมาชิก)* |
| สร้าง Task / Subtask (`task:create`) | ❌ | ✅ | ✅ | ✅ |
| แก้ไขรายละเอียด / ย้ายสถานะ Task (`task:update`, `task:move`) | ❌ | ✅ | ✅ | ✅ |
| ลบ Task (`task:delete`) | ❌ | ✅ | ✅ | เฉพาะที่ตนสร้าง |
| จัดการ Task Dependency (`task:manage_dependencies`) | ❌ | ✅ | ✅ | ✅ |
| เพิ่มความคิดเห็น (`comment:create`) | ❌ | ✅ | ✅ | ✅ |
| แก้ไขความคิดเห็น (`comment:update`) | ❌ | เฉพาะของตน | เฉพาะของตน | เฉพาะของตน |
| ลบความคิดเห็น (`comment:delete`) | ❌ | ✅ | ✅ | เฉพาะของตน |
| อัปโหลดไฟล์แนบ (`attachment:upload`) | ❌ | ✅ | ✅ | ✅ |
| ลบไฟล์แนบ (`attachment:delete`) | ❌ | ✅ | ✅ | เฉพาะที่ตนอัปโหลด |
| ดู Dashboard & Activity Log ของโปรเจกต์ (`analytics:read`) | ❌ | ✅ | ✅ | ✅ |

---

## 3. Functional Requirements (`WS-002`)

### FR-01: Authentication & Account Lifecycle
- **FR-01.1**: ผู้ใช้สมัครสมาชิกด้วยชื่อ, อีเมล (ไม่ซ้ำ, แปลงเป็นตัวพิมพ์เล็กเสมอ) และรหัสผ่าน (อย่างน้อย 8 ตัวอักษร) โดยเก็บรหัสผ่านแบบ `Argon2id`
- **FR-01.2**: ระบบส่งลิงก์ยืนยันอีเมล (Email Verification) และรองรับการขอตั้งรหัสผ่านใหม่ (Forgot/Reset Password) ด้วยโทเคนแบบใช้ครั้งเดียวที่มีอายุจำกัด
- **FR-01.3**: ระบบออก Access Token อายุสั้นควบคู่กับ Refresh Token ใน `HttpOnly` Cookie พร้อมระบบ **Refresh Token Rotation** — หากตรวจพบการนำ Refresh Token เก่าที่ถูกหมุนไปแล้วกลับมาใช้ซ้ำ (Token Reuse) ต้องยกเลิกทุกเซสชันในตระกูลนั้นทันที
- **FR-01.4**: เมื่อรหัสผ่านผิดหรืออีเมลไม่มีในระบบ ต้องคืน `401 Unauthorized` ด้วยข้อความเดียวกันเพื่อป้องกันการไล่เช็กบัญชี (User Enumeration)

### FR-02: Organization, Workspace & Invitations
- **FR-02.1**: ผู้ใช้ที่ล็อกอินแล้วสามารถสร้าง Organization ใหม่ได้ (ผู้สร้างเป็น `ORG_OWNER` อัตโนมัติ และสร้าง Workspace เริ่มต้นให้ใน Transaction เดียวกัน)
- **FR-02.2**: ผู้ใช้ 1 คนสังกัดได้หลาย Organization และสลับบริบทการทำงานได้
- **FR-02.3**: `ORG_OWNER` ส่งคำเชิญทางอีเมลพร้อมกำหนด Role; คำเชิญมีวันหมดอายุ (เช่น 7 วัน) สามารถยกเลิก (Revoke) หรือกดยอมรับ (Accept) ได้
- **FR-02.4**: องค์กรต้องมี `ORG_OWNER` อย่างน้อย 1 คนเสมอ ระบบต้องปฏิเสธการลดขั้นหรือลบ Owner คนสุดท้าย

### FR-03: Project, Task, Subtask & Dependencies
- **FR-03.1**: Project อยู่ภายใต้ Workspace มีรหัสย่อ (`key` 2–6 ตัวอักษรพิมพ์ใหญ่ เช่น `WS`) ไม่ซ้ำภายในองค์กร และสร้างคอลัมน์เริ่มต้น (`To Do`, `In Progress`, `In Review`, `Done`) ให้อัตโนมัติ
- **FR-03.2**: ทุก Task ได้รับเลขรันต่อเนื่องต่อโปรเจกต์ (`WS-1`, `WS-2`, ...) โดยปลอดภัยจากปัญหาเลขซ้ำเมื่อสร้างพร้อมกัน
- **FR-03.3**: รองรับ Subtask ภายใต้ Task หลัก, การกำหนด Assignee (ต้องเป็นสมาชิกที่มีสิทธิ์ในโปรเจกต์), Priority (`LOWEST`–`HIGHEST`), Due Date และ Tags
- **FR-03.4**: รองรับการผูก Dependency (`Task B` ต้องรอ `Task A`):
  - ห้ามผูกกับตัวเอง หรือผูกข้ามโปรเจกต์
  - ตรวจจับวงจรปิด (เช่น `A -> B -> C -> A`) ด้วย Graph Traversal และปฏิเสธด้วย `422/409`
  - ห้ามย้าย Task ไปยังคอลัมน์หมวด `DONE` หากยังมีงานต้นทางที่ยังไม่ `DONE`

### FR-04: Kanban Board, Search & Concurrency
- **FR-04.1**: ลากวางการ์ดข้ามคอลัมน์หรือสลับลำดับในคอลัมน์เดิม โดยบันทึกค่าลำดับด้วย Fractional Indexing (อัปเดตเฉพาะใบที่ขยับ ยกเว้นกรณีต้องปรับสมดุล)
- **FR-04.2**: ค้นหาและกรอง Task ตามคำค้น (title/description/key), สถานะ, ผู้รับผิดชอบ, ความสำคัญ, Tag, วันครบกำหนด พร้อมการเรียงลำดับและ Cursor/Offset Pagination
- **FR-04.3**: การแก้ไข Task ใช้ `version` (Optimistic Locking) — หากผู้ใช้สองคนแก้ใบเดียวกันพร้อมกัน คนที่ส่งทีหลังจะได้ `409 Conflict` พร้อมข้อมูลล่าสุดแทนการเขียนทับเงียบๆ

### FR-05: Collaboration, Realtime, Notifications & Jobs
- **FR-05.1**: สมาชิกโปรเจกต์แสดงความคิดเห็น แก้ไข/ลบคอมเมนต์ของตน รองรับ `@mention` และแนบไฟล์ขนาด/ชนิดที่กำหนด
- **FR-05.2**: Socket.IO ตรวจสอบสิทธิ์ก่อนให้เข้าห้อง `project:{projectId}` และ `user:{userId}` แล้วกระจาย event เมื่อมีการสร้าง/แก้ไข/ย้าย Task หรือคอมเมนต์ใหม่
- **FR-05.3**: สร้าง Notification เมื่อได้รับมอบหมายงาน, ถูกกล่าวถึง, สถานะงานที่เกี่ยวข้องเปลี่ยน หรือได้รับคำเชิญ พร้อมทำเครื่องหมายว่าอ่านแล้วได้
- **FR-05.4**: บันทึก Activity/Audit Log สำหรับเหตุการณ์สำคัญ และประมวลผลงานเบื้องหลังผ่าน BullMQ (อีเมลเชิญ, แจ้งเตือนใกล้ครบกำหนด, ส่งออกข้อมูล, สรุปรายสัปดาห์)

---

## 4. Non-Functional Requirements (`WS-002`)

| หมวดหมู่ | ข้อกำหนด (Requirement) | แนวทางวัดผล / บังคับใช้ |
|---|---|---|
| **Tenant Isolation** | ข้อมูลขององค์กรหนึ่งต้องไม่รั่วไหลไปสู่อีกองค์กรหนึ่งไม่ว่ากรณีใด | ทุกตารางข้อมูลหลักมี `orgId` กำกับ; มีชุด Negative Integration Tests ยิงข้าม Tenant |
| **Security** | ป้องกัน SQLi, XSS, CSRF, Brute-force, Token Theft และ File Upload อันตราย | Prisma parameterized queries, Zod validation, Origin/SameSite check, Redis rate-limit, MIME/size whitelist |
| **Consistency** | การทำงานหลายขั้นตอนต้องสำเร็จทั้งหมดหรือยกเลิกทั้งหมด และไม่เกิด Lost Update | `db.$transaction(...)` และคอลัมน์ `version` (Optimistic Locking) |
| **Performance** | API อ่านข้อมูลทั่วไปควรตอบสนองระดับ `< 300ms` (p95 ในสภาวะทดสอบปกติ) และไม่มี N+1 | Composite DB Indexes, Cursor Pagination, Redis Cache สำหรับ summary/metadata, Load test เป้าหมายทดลอง 100 VUs |
| **Reliability** | งานเบื้องหลังที่ล้มเหลวชั่วคราวต้องลองใหม่ได้โดยไม่ทำงานซ้ำซ้อน | BullMQ exponential backoff + deterministic `jobId` / idempotency check |
| **Internationalization** | รองรับภาษาไทย (`th`) และภาษาอังกฤษ (`en`) ทั้ง UI และข้อความแจ้งเตือนหลัก | `next-intl` แยกไฟล์แปลภาษา `messages/th.json`, `messages/en.json` |
| **Maintainability** | โค้ดแยกชั้นชัดเจน ทดสอบอัตโนมัติได้ใน CI ทุกครั้งที่เปิด Pull Request | TypeScript strict mode, ESLint, Vitest (Unit/API), Playwright (E2E), GitHub Actions |
