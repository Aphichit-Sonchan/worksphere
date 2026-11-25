# WorkSphere — Complete Engineering Documentation Index

สารบัญเอกสารการออกแบบระบบ รายงานผลการทดสอบ คู่มือปฏิบัติการ Production และเอกสารสรุปเชิงวิศวกรรมสำหรับ Portfolio ทั้งหมดของ **WorkSphere** (`Phase 0` – `Phase 8`):

1. **[Scope, Roles & Requirements (`WS-001`, `WS-002`)](./requirements.md)** — ขอบเขตโปรเจกต์, บทบาทผู้ใช้งานทั้ง 4 ระดับ, ตาราง Permission Matrix และข้อกำหนด Functional / Non-functional
2. **[Use Case & Sequence Diagrams (`WS-003`)](./use-cases.md)** — แผนภาพความสัมพันธ์ผู้ใช้งานกับระบบ และลำดับการทำงานของ Flow สำคัญ
3. **[ER Diagram & Indexing Plan (`WS-004`)](./erd.md)** — โครงสร้างตารางฐานข้อมูลครบทุกโมดูล (`Organization` → `Workspace` → `Project` → `Task`/`Subtask`, `TaskDependency`, `Session` rotation, `version` optimistic locking)
4. **[System Architecture & Conventions (`WS-005`)](./architecture.md)** — สถาปัตยกรรมบน Next.js + Socket.IO + Redis + BullMQ, โครงสร้างโฟลเดอร์, มาตรฐานโค้ด และ Definition of Done
5. **[REST API & Realtime Specification (`WS-006`)](./api-spec.md)** — รายละเอียด Endpoint `/api/v1/*`, รูปแบบ Error Envelope, Cursor Pagination และ Socket.IO Events
6. **[Test, Security & 100-VU Performance Report (`WS-701` – `WS-705`)](./test-and-performance-report.md)** — สรุปชุดทดสอบอัตโนมัติ 43 ข้อ, Security Verification Matrix และผลการวัดโหลด 100 Concurrent Virtual Users
7. **[Production Deployment, Secrets & Backup Runbook (`WS-802`)](./deployment.md)** — สถาปัตยกรรม Production, การตั้งค่า Secrets/HTTPS, ขั้นตอน `prisma migrate deploy` และแผนสำรองข้อมูล PITR
8. **[Engineering Deep-Dives & English Resume Bullets (`WS-805`)](./technical-decisions.md)** — บทวิเคราะห์เชิงลึก 5 หัวข้อหลักสำหรับสัมภาษณ์งาน พร้อมข้อความสรุปผลงานภาษาอังกฤษสำหรับใส่ Resume
9. **[Sprint Backlog & Project Board (`WS-007`)](./backlog.md)** — ตารางติดตามสถานะใบงานครบทั้ง 9 เฟส (`Phase 0` – `Phase 8`)
