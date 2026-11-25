# WorkSphere — REST API & Realtime Specification (`WS-006`)

ทุก REST Endpoint อยู่ภายใต้ Base Path `/api/v1` รับ-ส่งข้อมูลเป็น `application/json` (ยกเว้นการอัปโหลดไฟล์แบบ multipart/presigned)

---

## 1. มาตรฐานการตอบกลับ ข้อผิดพลาด และการแบ่งหน้า

### 1.1 Success Envelope
```json
{
  "data": { "id": "clx...", "title": "Setup database" },
  "meta": { "nextCursor": "clx_next", "hasMore": true }
}
```

### 1.2 Standard Error Envelope
```json
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "Task was modified by another user",
    "details": { "currentVersion": 4 }
  }
}
```

| HTTP Status | Error Code | ความหมายและการใช้งาน |
|:-:|---|---|
| `400` | `BAD_REQUEST` | JSON ผิดรูปแบบ หรือพารามิเตอร์ไม่ถูกต้อง |
| `401` | `UNAUTHENTICATED` | ไม่ได้ล็อกอิน หรือ Access/Refresh Token หมดอายุ/ถูกยกเลิก |
| `403` | `FORBIDDEN` | เป็นสมาชิกในองค์กรแต่ Role ไม่มีสิทธิ์ทำรายการนี้ |
| `404` | `NOT_FOUND` | ไม่พบข้อมูล **หรือข้อมูลอยู่คนละ Organization (ป้องกันการเดา ID)** |
| `409` | `CONFLICT` / `VERSION_CONFLICT` / `DEPENDENCY_CYCLE` / `DEPENDENCY_INCOMPLETE` | ข้อมูลซ้ำ, แก้ไขชนกัน, เกิดวงจร Dependency หรือติดงานต้นทางที่ยังไม่เสร็จ |
| `422` | `VALIDATION_ERROR` | ข้อมูลไม่ผ่านกฎของ Zod schema (แนบ `fieldErrors` ใน `details`) |
| `429` | `RATE_LIMITED` | ส่งคำขอเกินจำนวนที่กำหนดต่อช่วงเวลา |
| `500` | `INTERNAL` | ข้อผิดพลาดภายในระบบ (ไม่เปิดเผย stack trace ออกสู่ภายนอก) |

### 1.3 Pagination Contract
- **Cursor Pagination** (ใช้กับ Tasks, Comments, Activity Logs, Notifications): `?cursor=<id>&limit=25` (สูงสุด `100`)
- **Filtering & Sorting สำหรับ Tasks**: `?q=keyword&columnId=...&assigneeId=...&priority=HIGH,HIGHEST&tagId=...&dueBefore=...&sort=createdAt:desc`

---

## 2. รายการ REST API Endpoints แยกตามโมดูล

### 2.1 System & Health
| Method | Endpoint | Auth / Role | รายละเอียด |
|---|---|---|---|
| `GET` | `/api/v1/health` | Public | ตรวจสถานะเซิร์ฟเวอร์ (`?deep=1` ตรวจ PostgreSQL และ Redis) |
| `GET` | `/api/v1/admin/organizations` | `SYSTEM_ADMIN` | ดูรายชื่อองค์กรและสถิติระดับแพลตฟอร์ม |
| `PATCH` | `/api/v1/admin/organizations/:orgId` | `SYSTEM_ADMIN` | ระงับ / ปลดระงับการใช้งานองค์กร (`suspendedAt`) |

### 2.2 Authentication & Account (`/api/v1/auth`)
| Method | Endpoint | Auth | Payload / พฤติกรรมหลัก |
|---|---|---|---|
| `POST` | `/auth/register` | Public (Rate-limited) | `{ name, email, password, locale? }` → `201` + ส่งอีเมลยืนยัน |
| `POST` | `/auth/login` | Public (Rate-limited) | `{ email, password }` → `200` + ตั้ง `HttpOnly` Access & Refresh Cookies |
| `POST` | `/auth/refresh` | Refresh Cookie | หมุน Refresh Token ใหม่ (หากพบการใช้ซ้ำจะเพิกถอนทั้ง `familyId` แล้วคืน `401`) |
| `POST` | `/auth/logout` | Authenticated | `{ allDevices?: boolean }` → เพิกถอนเซสชันและล้าง Cookie |
| `GET` | `/auth/me` | Authenticated | คืนข้อมูลผู้ใช้ปัจจุบันและรายการองค์กรที่สังกัด |
| `POST` | `/auth/verify-email` | Public | `{ token }` → ยืนยันอีเมล |
| `POST` | `/auth/forgot-password` | Public (Rate-limited) | `{ email }` → ตอบ `200` เสมอและส่งลิงก์รีเซ็ตหากมีบัญชีจริง |
| `POST` | `/auth/reset-password` | Public | `{ token, newPassword }` → เปลี่ยนรหัสผ่านและเพิกถอนเซสชันเก่าทั้งหมด |

### 2.3 Organizations & Invitations
| Method | Endpoint | สิทธิ์ขั้นต่ำ | รายละเอียด |
|---|---|---|---|
| `GET` | `/organizations` | Authenticated | รายชื่อองค์กรที่ผู้ใช้เป็นสมาชิก |
| `POST` | `/organizations` | Authenticated | `{ name, slug }` → สร้างองค์กร + ตั้งเป็น `ORG_OWNER` + สร้าง Workspace เริ่มต้น |
| `GET` | `/organizations/:orgId` | Org Member | ดูรายละเอียดองค์กร |
| `PATCH` | `/organizations/:orgId` | `ORG_OWNER` | แก้ไขชื่อหรือการตั้งค่าองค์กร |
| `DELETE` | `/organizations/:orgId` | `ORG_OWNER` | Soft-delete องค์กร |
| `GET` | `/organizations/:orgId/members` | Org Member | ดูรายชื่อสมาชิกและบทบาท |
| `PATCH` | `/organizations/:orgId/members/:userId` | `ORG_OWNER` | `{ role }` เปลี่ยนบทบาท (ห้ามลดขั้น Owner คนสุดท้าย) |
| `DELETE` | `/organizations/:orgId/members/:userId` | `ORG_OWNER` | ถอดสมาชิกออกจากองค์กร |
| `GET` | `/organizations/:orgId/invitations` | `ORG_OWNER` | ดูรายการคำเชิญที่กำลังรอตอบรับ |
| `POST` | `/organizations/:orgId/invitations` | `ORG_OWNER` | `{ email, role, workspaceId? }` → สร้างคำเชิญและเข้าคิวส่งอีเมล (`201`) |
| `DELETE` | `/organizations/:orgId/invitations/:invitationId` | `ORG_OWNER` | ยกเลิกคำเชิญ (`revokedAt`) |
| `POST` | `/invitations/:token/accept` | Authenticated | กดยอมรับคำเชิญเข้าองค์กร/Workspace |

### 2.4 Workspaces
| Method | Endpoint | สิทธิ์ขั้นต่ำ | รายละเอียด |
|---|---|---|---|
| `GET` | `/organizations/:orgId/workspaces` | Org Member | รายการ Workspace ที่ผู้ใช้มีสิทธิ์เข้าถึงในองค์กร |
| `POST` | `/organizations/:orgId/workspaces` | `ORG_OWNER` | `{ name, slug, description? }` → สร้าง Workspace (`201`) |
| `GET` | `/workspaces/:workspaceId` | Workspace Member | ดูข้อมูล Workspace |
| `PATCH` | `/workspaces/:workspaceId` | `ORG_OWNER` | แก้ไขชื่อ / รายละเอียด / Archive |
| `GET` | `/workspaces/:workspaceId/members` | Workspace Member | ดูสมาชิกใน Workspace |
| `POST` | `/workspaces/:workspaceId/members` | `ORG_OWNER` | `{ userId, role }` เพิ่มสมาชิกองค์กรเข้าสู่ Workspace |
| `DELETE` | `/workspaces/:workspaceId/members/:userId` | `ORG_OWNER` | นำสมาชิกออกจาก Workspace |

### 2.5 Projects, Board Columns & Tags
| Method | Endpoint | สิทธิ์ขั้นต่ำ | รายละเอียด |
|---|---|---|---|
| `GET` | `/workspaces/:workspaceId/projects` | Workspace Member | รายการโปรเจกต์ใน Workspace |
| `POST` | `/workspaces/:workspaceId/projects` | `PROJECT_MANAGER` / `ORG_OWNER` | `{ key, name, description? }` → สร้างโปรเจกต์พร้อมคอลัมน์เริ่มต้น (`201`) |
| `GET` | `/projects/:projectId` | Project Member | ดูรายละเอียดโปรเจกต์พร้อมคอลัมน์และ Tags |
| `PATCH` | `/projects/:projectId` | `PROJECT_MANAGER` | แก้ไขโปรเจกต์ หรือสั่ง Archive/Restore |
| `GET` | `/projects/:projectId/members` | Project Member | ดูสมาชิกในโปรเจกต์ |
| `POST` | `/projects/:projectId/members` | `PROJECT_MANAGER` | `{ userId, role }` กำหนดบทบาทในโปรเจกต์ |
| `PATCH` | `/projects/:projectId/members/:userId` | `PROJECT_MANAGER` | เปลี่ยนบทบาท (`PROJECT_MANAGER`, `MEMBER`, `VIEWER`) |
| `DELETE` | `/projects/:projectId/members/:userId` | `PROJECT_MANAGER` | ถอดสมาชิกออกจากโปรเจกต์ |
| `POST` | `/projects/:projectId/columns` | `PROJECT_MANAGER` | `{ name, category, afterColumnId?, wipLimit? }` เพิ่มคอลัมน์ Kanban |
| `PATCH` | `/projects/:projectId/columns/:columnId` | `PROJECT_MANAGER` | แก้ชื่อ / หมวดหมู่ / ลำดับคอลัมน์ |
| `DELETE` | `/projects/:projectId/columns/:columnId` | `PROJECT_MANAGER` | ลบคอลัมน์ (ต้องย้ายงานออกก่อน หรือระบุ `moveToColumnId`) |
| `POST` | `/projects/:projectId/tags` | Project `MEMBER` | `{ name, color }` สร้างป้ายกำกับงาน |

### 2.6 Tasks, Subtasks, Kanban Move & Dependencies
| Method | Endpoint | สิทธิ์ขั้นต่ำ | รายละเอียด |
|---|---|---|---|
| `GET` | `/projects/:projectId/tasks` | Project Member | ค้นหา กรอง เรียงลำดับ และแบ่งหน้ารายการ Task |
| `POST` | `/projects/:projectId/tasks` | Project `MEMBER` | `{ title, description?, columnId?, priority?, assigneeId?, dueDate?, parentId?, tagIds? }` → `201` |
| `GET` | `/tasks/:taskId` | Project Member | ดูรายละเอียด Task พร้อม Subtasks, Dependencies, Tags, Attachment metadata |
| `PATCH` | `/tasks/:taskId` | Project `MEMBER` | `{ ...fields, version }` แก้ไขงาน (ตรวจ Optimistic Lock `version` และกฎ Dependency) |
| `PATCH` | `/tasks/:taskId/move` | Project `MEMBER` | `{ columnId, beforeTaskId?, afterTaskId?, version }` ย้ายการ์ดบน Kanban และคำนวณ `position` |
| `DELETE` | `/tasks/:taskId` | `PROJECT_MANAGER` หรือผู้สร้าง | Soft-delete งานและงานย่อย |
| `POST` | `/tasks/:taskId/subtasks` | Project `MEMBER` | `{ title, assigneeId?, priority? }` สร้างงานย่อยภายใต้ `taskId` (`201`) |
| `POST` | `/tasks/:taskId/dependencies` | Project `MEMBER` | `{ dependsOnTaskId }` ผูกงานต้นทาง พร้อมตรวจ Cycle Detection |
| `DELETE` | `/tasks/:taskId/dependencies/:depId` | Project `MEMBER` | ยกเลิกความสัมพันธ์ระหว่างงาน |

### 2.7 Comments & Attachments
| Method | Endpoint | สิทธิ์ขั้นต่ำ | รายละเอียด |
|---|---|---|---|
| `GET` | `/tasks/:taskId/comments` | Project Member | ดึงรายการความคิดเห็นแบบ Cursor Pagination |
| `POST` | `/tasks/:taskId/comments` | Project Member | `{ body }` เพิ่มความคิดเห็น + สแกน `@mention` เพื่อแจ้งเตือน (`201`) |
| `PATCH` | `/comments/:commentId` | เจ้าของคอมเมนต์ | `{ body }` แก้ไขความคิดเห็นของตนเอง |
| `DELETE` | `/comments/:commentId` | `PROJECT_MANAGER` หรือเจ้าของ | ลบความคิดเห็น |
| `POST` | `/uploads/presigned-url` | Project `MEMBER` | `{ taskId, fileName, mimeType, sizeBytes }` ขอ URL/Token สำหรับอัปโหลดไฟล์ |
| `POST` | `/tasks/:taskId/attachments` | Project `MEMBER` | บันทึก Metadata หรืออัปโหลดไฟล์แนบผูกกับงาน (`201`) |
| `DELETE` | `/attachments/:attachmentId` | `PROJECT_MANAGER` หรือผู้อัปโหลด | ลบไฟล์แนบออกจาก Storage และฐานข้อมูล |

### 2.8 Notifications, Activity & Dashboard
| Method | Endpoint | สิทธิ์ขั้นต่ำ | รายละเอียด |
|---|---|---|---|
| `GET` | `/notifications` | Authenticated | รายการแจ้งเตือนของผู้ใช้ (`?unreadOnly=1&cursor=...`) |
| `PATCH` | `/notifications/:id/read` | เจ้าของแจ้งเตือน | ทำเครื่องหมายว่าอ่านแล้ว |
| `POST` | `/notifications/read-all` | Authenticated | อ่านทั้งหมด |
| `GET` | `/projects/:projectId/activity` | Project Member | ประวัติการเคลื่อนไหวในโปรเจกต์ |
| `GET` | `/organizations/:orgId/audit-logs` | `ORG_OWNER` | บันทึก Audit ระดับองค์กร |
| `GET` | `/organizations/:orgId/dashboard/summary` | Org Member | สรุปจำนวนงาน งานค้าง งานใกล้ครบกำหนดของผู้ใช้และองค์กร |
| `GET` | `/projects/:projectId/analytics` | Project Member | สถิติงานแยกตามสถานะ ความสำคัญ ผู้รับผิดชอบ และอัตราการปิดงาน |
| `POST` | `/projects/:projectId/exports` | `PROJECT_MANAGER` | เข้าคิว BullMQ เพื่อส่งออกรายการงานเป็น CSV/JSON (`202 Accepted`) |

---

## 3. ข้อกำหนด Realtime Events (Socket.IO Contract)

### 3.1 Rooms & Authorization
- `user:{userId}` — เข้าห้องอัตโนมัติหลังผ่าน Auth Handshake สำหรับรับ Notification ส่วนตัว
- `project:{projectId}` — Client ส่ง `project:join { projectId }`, Server ตรวจสิทธิ์สมาชิกโปรเจกต์ก่อนอนุญาต หากไม่มีสิทธิ์จะตอบ callback `{ ok: false, code: "FORBIDDEN" }`

### 3.2 Server-to-Client Events
| Event Name | Room เป้าหมาย | Payload หลัก |
|---|---|---|
| `task.created` | `project:{projectId}` | `{ task, actorId }` |
| `task.updated` | `project:{projectId}` | `{ task, changedFields, actorId }` |
| `task.moved` | `project:{projectId}` | `{ taskId, fromColumnId, toColumnId, position, version, actorId }` |
| `task.deleted` | `project:{projectId}` | `{ taskId, actorId }` |
| `comment.created` | `project:{projectId}` | `{ taskId, comment }` |
| `comment.updated` / `comment.deleted` | `project:{projectId}` | `{ taskId, commentId, body? }` |
| `activity.logged` | `project:{projectId}` | `{ activity }` |
| `notification.created` | `user:{userId}` | `{ notification, unreadCount }` |
| `presence.updated` *(optional)* | `project:{projectId}` | `{ onlineUserIds }` |
