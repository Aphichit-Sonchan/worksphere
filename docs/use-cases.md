# WorkSphere — Use Case Diagrams & Scenarios (`WS-003`)

เอกสารนี้แสดงความสัมพันธ์ระหว่างผู้ใช้งานทั้ง 4 บทบาท (`System Admin`, `Organization Owner`, `Project Manager`, `Member`) กับฟีเจอร์หลักของระบบ WorkSphere

## 1. ภาพรวม Use Case ตามบทบาท (Actor-Goal Diagram)

```mermaid
flowchart LR
  SA["👤 System Admin"]
  OO["👤 Organization Owner"]
  PM["👤 Project Manager"]
  MB["👤 Member"]

  subgraph Auth["Authentication & Account"]
    UC_AUTH["สมัคร / ล็อกอิน / รีเซ็ตรหัสผ่าน / ยืนยันอีเมล"]
    UC_CREATE_ORG["สร้าง Organization ใหม่"]
  end

  subgraph Platform["Platform Administration"]
    UC_SYS_DASH["ดูภาพรวมแพลตฟอร์ม & System Audit"]
    UC_SYS_TENANT["ระงับ / ปลดระงับ Organization หรือผู้ใช้"]
  end

  subgraph OrgMgmt["Organization & Workspace"]
    UC_ORG_SET["ตั้งค่า / ลบ Organization"]
    UC_INVITE["เชิญสมาชิก & จัดการ Role ระดับองค์กร"]
    UC_WS["สร้าง / จัดการ Workspace และสมาชิก"]
  end

  subgraph ProjMgmt["Project Management"]
    UC_PROJ["สร้าง / แก้ไข / Archive Project"]
    UC_PROJ_MEM["เพิ่ม / ถอดสมาชิกใน Project"]
    UC_COL["ตั้งค่าคอลัมน์ Kanban Board"]
  end

  subgraph Work["Task, Board & Collaboration"]
    UC_TASK["สร้าง / แก้ไข Task & Subtask"]
    UC_DEP["ผูก Task Dependency (พร้อมตรวจวงจรปิด)"]
    UC_KANBAN["ลากวางการ์ดบน Kanban & อัปเดตสถานะ"]
    UC_COLLAB["คอมเมนต์ (@mention) & แนบไฟล์"]
    UC_SEARCH["ค้นหา / กรองงาน / ดู Activity & Notification"]
    UC_ANALYTICS["ดู Dashboard & รายงานความคืบหน้า"]
  end

  SA --> UC_AUTH
  SA --> UC_SYS_DASH
  SA --> UC_SYS_TENANT

  OO --> UC_ORG_SET
  OO --> UC_INVITE
  OO --> UC_WS

  PM --> UC_PROJ
  PM --> UC_PROJ_MEM
  PM --> UC_COL

  MB --> UC_AUTH
  MB --> UC_CREATE_ORG
  MB --> UC_TASK
  MB --> UC_DEP
  MB --> UC_KANBAN
  MB --> UC_COLLAB
  MB --> UC_SEARCH
  MB --> UC_ANALYTICS

  %% Role inheritance inside tenant/project
  OO -.->|สืบทอดสิทธิ์ระดับ Project| PM
  PM -.->|สืบทอดสิทธิ์ระดับผู้ปฏิบัติงาน| MB
```

---

## 2. ลำดับการทำงานของ Use Case สำคัญ (Key Flows)

### UC-01: เชิญสมาชิกเข้าองค์กรและยอมรับคำเชิญ (Invitation Lifecycle)
```mermaid
sequenceDiagram
  actor Owner as Organization Owner
  participant API as WorkSphere API
  participant DB as PostgreSQL
  participant Q as BullMQ Email Worker
  actor Invitee as ผู้ถูกเชิญ (Member)

  Owner->>API: POST /api/v1/organizations/:orgId/invitations {email, role}
  API->>DB: ตรวจสิทธิ์ ORG_OWNER + สร้าง Invitation (เก็บ SHA-256 tokenHash)
  API->>Q: Enqueue job "invitation.send_email"
  API-->>Owner: 201 Created
  Q-->>Invitee: ส่งลิงก์เชิญพร้อม raw token

  Invitee->>API: POST /api/v1/invitations/:token/accept
  API->>DB: Transaction: ตรวจวันหมดอายุ -> สร้าง OrganizationMember -> ประทับ acceptedAt
  API-->>Invitee: 200 OK (เข้าถึงองค์กรได้ทันที)
```

### UC-02: ย้ายการ์ดบน Kanban พร้อมตรวจ Dependency & Optimistic Locking
```mermaid
sequenceDiagram
  actor User as Member / PM
  participant UI as Next.js Kanban UI
  participant API as WorkSphere API
  participant DB as PostgreSQL
  participant WS as Socket.IO Server
  actor Peer as สมาชิกคนอื่นในห้องโปรเจกต์

  User->>UI: ลากการ์ด ENG-12 ไปคอลัมน์ "Done"
  UI->>UI: Optimistic UI update ทันที
  UI->>API: PATCH /api/v1/tasks/:id/move {columnId, position, version}
  API->>DB: ตรวจสิทธิ์สมาชิกโปรเจกต์ + โหลด Task & Dependencies
  alt มีงานต้นทางที่ยังไม่ Done
    API-->>UI: 409 DEPENDENCY_INCOMPLETE (UI เด้งการ์ดกลับที่เดิม)
  else version ไม่ตรงกับ DB (มีคนอื่นเพิ่งแก้ตัดหน้า)
    API-->>UI: 409 VERSION_CONFLICT พร้อม state ล่าสุด
  else ผ่านทุกเงื่อนไข
    API->>DB: Transaction: update columnId, position, version+1 + insert ActivityLog
    API->>WS: Publish "task.moved" ไปห้อง project:{projectId}
    WS-->>Peer: อัปเดตตำแหน่งการ์ดบนหน้าจอทันที
    API-->>UI: 200 OK (ยืนยันตำแหน่งและ version ใหม่)
  end
```
