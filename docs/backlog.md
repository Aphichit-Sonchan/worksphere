# WorkSphere — Sprint Backlog & Task Tracking (`WS-007`)

ทำงานแบบ **Sprint / Phase-Driven**: ทำทีละงานตามลำดับ เมื่อครบทุกงานใน Phase และผ่านเกณฑ์ส่งมอบแล้ว **ต้องหยุดสรุปและรับการยืนยันก่อนเริ่ม Phase ถัดไปเสมอ**

## มาตรฐานใบงาน (Task Template)
ทุกใบงาน (`WS-xxx`) เวลาลงมือทำจะยึดองค์ประกอบ 7 ส่วนนี้:
1. **Objective**: เป้าหมายของใบงาน
2. **Requirements**: สิ่งที่ต้องทำและข้อห้ามด้านความปลอดภัย
3. **Technical Design**: API / Schema / Permission / Edge cases
4. **Implementation**: โค้ดที่สร้างหรือแก้ไข
5. **Testing**: Unit / API Integration / E2E / Security checks
6. **Acceptance Criteria**: เงื่อนไขชี้วัดว่าผ่าน
7. **Review**: ตรวจทานคุณภาพและเอกสาร

---

## ตารางสถานะใบงานทั้งโปรเจกต์ (Master Project Board)

### Sprint 0 / Phase 0 — Planning & System Design
| ID | Task | Deliverable | Status |
|---|---|---|:-:|
| `WS-001` | Define Project Scope and User Roles | [`docs/requirements.md`](./requirements.md) (§1–§2) | ✅ Done |
| `WS-002` | Write Functional and Non-functional Requirements | [`docs/requirements.md`](./requirements.md) (§3–§4) | ✅ Done |
| `WS-003` | Create Use Case Diagram | [`docs/use-cases.md`](./use-cases.md) | ✅ Done |
| `WS-004` | Draft ER Diagram & Indexing Plan | [`docs/erd.md`](./erd.md) | ✅ Done |
| `WS-005` | Design System Architecture & Conventions | [`docs/architecture.md`](./architecture.md) | ✅ Done |
| `WS-006` | Draft REST API & Realtime Specification | [`docs/api-spec.md`](./api-spec.md) | ✅ Done |
| `WS-007` | Initialize Repository Docs & Project Board | [`docs/backlog.md`](./backlog.md), [`docs/README.md`](./README.md) | ✅ Done |

### Sprint 1 / Phase 1 — Setup & Infrastructure
| ID | Task | Status |
|---|---|:-:|
| `WS-101` | จัดโครงสร้างโปรเจกต์ Next.js ให้ตรงตาม Modular Architecture (`modules`, `infra`, `realtime`, `workers`) | ✅ Done |
| `WS-102` | ตั้งค่า UI & State (`Tailwind v4`, `shadcn/ui`, `TanStack Query`, `Zustand`, `next-intl` TH/EN) และแก้ build ให้ผ่าน 100% | ✅ Done |
| `WS-103` | อัปเดต `prisma/schema.prisma` ให้ตรงกับ ERD (`WS-004`) และรัน Migration แรกขึ้น Neon PostgreSQL (`20261124200834_init`) | ✅ Done |
| `WS-104` | ตั้งค่า Env validation (`zod`), Logger, Redis/Storage/Mail adapters และ `docker-compose.yml` | ✅ Done |
| `WS-105` | สร้าง `/api/v1/health` (App + DB + Redis + Storage) พร้อมชุดทดสอบ | ✅ Done |

### Sprint 2 / Phase 2 — Authentication & Security
| ID | Task | Status |
|---|---|:-:|
| `WS-201` | Register, Login, Logout, Argon2id hashing และ Refresh Token Rotation + Reuse Detection | ✅ Done |
| `WS-202` | Email Verification และ Forgot / Reset Password flow | ✅ Done |
| `WS-203` | Validation, CSRF/Origin protection, Security headers และ Redis/Memory Rate Limiting | ✅ Done |
| `WS-204` | หน้า UI สำหรับ Auth ครบชุด (Register, Login, Forgot/Reset, Verify, App Shell) สองภาษา | ✅ Done |
| `WS-205` | Auth & Token Lifecycle Security Tests (expired, invalid, brute-force, token reuse, CSRF) | ✅ Done |

### Sprint 3 / Phase 3 — Organization, Workspace & Multi-tenancy
| ID | Task | Status |
|---|---|:-:|
| `WS-301` | Organization CRUD และตัวสลับองค์กร (Organization Switcher) | ✅ Done |
| `WS-302` | Workspace CRUD และการจัดการสมาชิกใน Workspace | ✅ Done |
| `WS-303` | Invitation Lifecycle (ส่งคำเชิญ, หมดอายุ, ยกเลิก, กดยอมรับ) | ✅ Done |
| `WS-304` | Backend RBAC Guards ทั้ง 4 บทบาทหลัก + Tenant Context Enforcement | ✅ Done |
| `WS-305` | Cross-Tenant Isolation Negative Tests (พิสูจน์ว่า Org A เข้าถึง Org B ไม่ได้) | ✅ Done |

### Sprint 4 / Phase 4 — Project & Task Engine
| ID | Task | Status |
|---|---|:-:|
| `WS-401` | Project CRUD, Archive/Restore และการจัดการ Project Members | ✅ Done |
| `WS-402` | Task & Subtask CRUD พร้อมเลขรันอัตโนมัติ (`KEY-1`), Assignee, Priority, Due date, Tags | ✅ Done |
| `WS-403` | Kanban Board Drag-and-Drop และการจัดลำดับด้วย Fractional Indexing | ✅ Done |
| `WS-404` | Task Dependencies (`blocks`/`blocked_by`), Cycle Detection (DFS) และการบล็อกสถานะ `DONE` | ✅ Done |
| `WS-405` | Search, Multi-filter, Sorting และ Cursor Pagination | ✅ Done |
| `WS-406` | Comments และระบบแนบไฟล์ผ่าน Storage Adapter | ✅ Done |

### Sprint 5 / Phase 5 — Realtime Collaboration
| ID | Task | Status |
|---|---|:-:|
| `WS-501` | Socket.IO Server, Auth Handshake และการตรวจสิทธิ์เข้าห้อง `project:{id}` | ✅ Done |
| `WS-502` | Realtime Broadcast สำหรับการแก้ไข/ย้าย Task และ Comment ซิงก์เข้ากับ TanStack Query | ✅ Done |
| `WS-503` | Activity & Audit Log บันทึกและแสดงผลไทม์ไลน์ของโปรเจกต์/องค์กร | ✅ Done |
| `WS-504` | Notification Center (Assigned, Mentioned, Status Changed, Invited) + Online Presence | ✅ Done |

### Sprint 6 / Phase 6 — Advanced Backend
| ID | Task | Status |
|---|---|:-:|
| `WS-601` | Optimistic Locking ด้วยคอลัมน์ `version` และการจัดการ `409 VERSION_CONFLICT` | ✅ Done |
| `WS-602` | Atomic Database Transactions และการทดสอบ Rollback เมื่อล้มเหลวกลางคัน | ✅ Done |
| `WS-603` | Redis Caching & Invalidation Strategy สำหรับข้อมูลโปรเจกต์ สมาชิก และ Dashboard | ✅ Done |
| `WS-604` | BullMQ Queues & Workers (ส่งอีเมล, เตือนกำหนดส่ง, ส่งออกไฟล์, สรุปรายสัปดาห์) | ✅ Done |
| `WS-605` | Database Indexing, Query Plan Tuning และการป้องกัน N+1 Queries | ✅ Done |

### Sprint 7 / Phase 7 — Testing & Performance
| ID | Task | Status |
|---|---|:-:|
| `WS-701` | ขยายชุด Unit Tests ครอบคลุม Domain Services, RBAC, Cycle Detection และ Ordering | ✅ Done |
| `WS-702` | API + Database Integration Tests ครบทุกกลุ่ม Endpoint | ✅ Done |
| `WS-703` | Playwright E2E Tests สำหรับเส้นทางใช้งานหลักของผู้ใช้ | ✅ Done |
| `WS-704` | Security Test Suite (Permission Matrix 4 Roles, Cross-tenant, Token/Socket Auth) | ✅ Done |
| `WS-705` | Dashboard & Analytics + Load Testing (เป้าหมายทดลอง 100 VUs) และสรุปรายงานผล | ✅ Done |

### Sprint 8 / Phase 8 — Deployment & Portfolio
| ID | Task | Status |
|---|---|:-:|
| `WS-801` | GitHub Actions CI/CD Pipeline (`lint` → `typecheck` → `test` → `build` → `deploy`) | ✅ Done |
| `WS-802` | Production Deployment, HTTPS, Secrets และแผนการ Backup/Migration | ✅ Done |
| `WS-803` | Seed ข้อมูลตัวอย่างและบัญชี Demo ที่ปลอดภัยสำหรับผู้เข้าชม | ✅ Done |
| `WS-804` | เอกสาร Portfolio ครบชุด (README, Diagrams, API Docs, Screenshots) | ✅ Done |
| `WS-805` | Technical Write-ups เชิงลึกและสรุปผลงานสำหรับใส่ Resume ภาษาอังกฤษ | ✅ Done |
