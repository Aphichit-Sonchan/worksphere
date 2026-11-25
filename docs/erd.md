# WorkSphere — Entity-Relationship Diagram & Data Dictionary (`WS-004`)

ออกแบบสำหรับ **PostgreSQL + Prisma** โดยรองรับ Multi-tenancy เต็มรูปแบบ (`Organization` → `Workspace` → `Project` → `Task` / `Subtask`), ระบบ Refresh Token Rotation, Task Dependency Graph, Optimistic Locking (`version`) และ Audit/Notification

## 1. ER Diagram

```mermaid
erDiagram
  User ||--o{ Session : "auth sessions"
  User ||--o{ VerificationToken : "email / reset tokens"
  User ||--o{ OrganizationMember : "belongs to"
  Organization ||--o{ OrganizationMember : "has members"
  Organization ||--o{ Invitation : "sends"
  Organization ||--o{ Workspace : "contains"
  Workspace ||--o{ WorkspaceMember : "grants access"
  User ||--o{ WorkspaceMember : "joins"
  Workspace ||--o{ Project : "organizes"
  Organization ||--o{ Project : "tenant scope"
  Project ||--o{ ProjectMember : "assigns role"
  User ||--o{ ProjectMember : "participates"
  Project ||--o{ BoardColumn : "kanban columns"
  Project ||--o{ Tag : "defines"
  Project ||--o{ Task : "tracks"
  BoardColumn ||--o{ Task : "groups"
  Task ||--o{ Task : "parent / subtasks"
  Task ||--o{ TaskDependency : "blocked by"
  Task ||--o{ TaskDependency : "blocks"
  Task ||--o{ TaskTag : "labeled"
  Tag ||--o{ TaskTag : "applied to"
  Task ||--o{ Comment : "discussed in"
  Task ||--o{ Attachment : "stores files"
  Organization ||--o{ ActivityLog : "audits"
  User ||--o{ Notification : "receives"

  User {
    cuid id PK
    string email UK "lowercase"
    string name
    string avatarUrl
    string passwordHash "Argon2id"
    enum systemRole "SYSTEM_ADMIN | USER"
    enum locale "th | en"
    datetime emailVerifiedAt
    datetime disabledAt
    datetime createdAt
    datetime updatedAt
  }

  Session {
    cuid id PK
    cuid userId FK
    string familyId "detect refresh reuse"
    string refreshTokenHash UK "SHA-256"
    string replacedByTokenHash
    datetime revokedAt
    datetime expiresAt
    string ipAddress
    string userAgent
    datetime createdAt
    datetime lastUsedAt
  }

  VerificationToken {
    cuid id PK
    cuid userId FK
    enum purpose "EMAIL_VERIFY | PASSWORD_RESET"
    string tokenHash UK "SHA-256"
    datetime expiresAt
    datetime consumedAt
    datetime createdAt
  }

  Organization {
    cuid id PK
    string name
    string slug UK
    cuid createdById FK
    datetime suspendedAt
    datetime deletedAt
    datetime createdAt
    datetime updatedAt
  }

  OrganizationMember {
    cuid id PK
    cuid orgId FK
    cuid userId FK
    enum role "ORG_OWNER | ORG_ADMIN | MEMBER"
    datetime createdAt
    datetime updatedAt
  }

  Invitation {
    cuid id PK
    cuid orgId FK
    cuid workspaceId FK "nullable"
    string email
    enum role "ORG_OWNER | ORG_ADMIN | MEMBER"
    string tokenHash UK "SHA-256"
    cuid invitedById FK
    datetime expiresAt
    datetime acceptedAt
    datetime revokedAt
    datetime createdAt
  }

  Workspace {
    cuid id PK
    cuid orgId FK
    string name
    string slug
    string description
    cuid createdById FK
    datetime archivedAt
    datetime createdAt
    datetime updatedAt
  }

  WorkspaceMember {
    cuid id PK
    cuid workspaceId FK
    cuid userId FK
    enum role "WORKSPACE_ADMIN | MEMBER"
    datetime createdAt
  }

  Project {
    cuid id PK
    cuid orgId FK "denormalized tenant key"
    cuid workspaceId FK
    string key "e.g. WS (unique per org)"
    string name
    string description
    int taskCounter "atomic sequence per project"
    cuid createdById FK
    datetime archivedAt
    datetime deletedAt
    datetime createdAt
    datetime updatedAt
  }

  ProjectMember {
    cuid id PK
    cuid projectId FK
    cuid userId FK
    enum role "PROJECT_MANAGER | MEMBER | VIEWER"
    datetime createdAt
  }

  BoardColumn {
    cuid id PK
    cuid projectId FK
    string name
    enum category "TODO | IN_PROGRESS | DONE"
    string position "fractional index"
    int wipLimit "nullable"
    datetime createdAt
  }

  Task {
    cuid id PK
    cuid orgId FK "denormalized tenant key"
    cuid projectId FK
    cuid columnId FK
    cuid parentId FK "nullable -> Subtask"
    int number "unique per project (e.g. 42 -> WS-42)"
    string title
    string description
    enum priority "LOWEST | LOW | MEDIUM | HIGH | HIGHEST"
    string position "fractional index in column"
    int version "optimistic locking (@default 1)"
    cuid assigneeId FK "nullable"
    cuid reporterId FK
    datetime dueDate "nullable"
    datetime completedAt "nullable"
    datetime deletedAt "soft delete"
    datetime createdAt
    datetime updatedAt
  }

  TaskDependency {
    cuid id PK
    cuid projectId FK
    cuid taskId FK "dependent task"
    cuid dependsOnTaskId FK "blocking prerequisite task"
    cuid createdById FK
    datetime createdAt
  }

  Tag {
    cuid id PK
    cuid projectId FK
    string name
    string color "hex"
  }

  TaskTag {
    cuid taskId PK,FK
    cuid tagId PK,FK
  }

  Comment {
    cuid id PK
    cuid orgId FK
    cuid taskId FK
    cuid authorId FK
    string body
    datetime editedAt
    datetime deletedAt
    datetime createdAt
  }

  Attachment {
    cuid id PK
    cuid orgId FK
    cuid taskId FK
    cuid uploaderId FK
    string fileName
    string mimeType
    int sizeBytes
    string storageKey UK
    datetime createdAt
  }

  ActivityLog {
    cuid id PK
    cuid orgId FK
    cuid workspaceId FK "nullable"
    cuid projectId FK "nullable"
    cuid taskId FK "nullable"
    cuid actorId FK
    string action "e.g. task.moved, member.invited"
    json metadata "before/after diff"
    datetime createdAt
  }

  Notification {
    cuid id PK
    cuid orgId FK
    cuid userId FK "recipient"
    string type "TASK_ASSIGNED | MENTIONED | STATUS_CHANGED | INVITED"
    string title
    string linkUrl
    json payload
    datetime readAt
    datetime createdAt
  }
```

---

## 2. เหตุผลเชิงวิศวกรรมของโครงสร้างข้อมูล (Key Design Decisions)

1. **Denormalized `orgId` เพื่อป้องกันข้อมูลรั่วข้ามองค์กร**
   - ตาราง `Workspace`, `Project`, `Task`, `Comment`, `Attachment`, `ActivityLog` และ `Notification` เก็บ `orgId` ไว้โดยตรง ทำให้ทุก Query สามารถใส่เงื่อนไข `WHERE orgId = ctx.orgId` ได้ทันทีโดยไม่ต้อง `JOIN` ย้อนหลายชั้น และสร้าง Composite Index ที่มี `orgId` นำหน้าได้
2. **Refresh Token Family (`Session.familyId` + `replacedByTokenHash`)**
   - ทุกครั้งที่ขอ Refresh Token ใหม่ แถวเดิมจะถูกบันทึก `replacedByTokenHash` และสร้างแถวใหม่ใน `familyId` เดียวกัน หากผู้โจมตีขโมย Token เก่ามาใช้ซ้ำ ระบบจะเห็นว่าแถวนั้นถูกหมุนไปแล้ว และสั่ง `revokedAt = now()` ทั้ง `familyId` ทันที
3. **เลขรหัสงานแบบ Jira (`Project.taskCounter` + `Task.number`)**
   - เมื่อสร้าง Task ใหม่ ระบบสั่ง `UPDATE Project SET taskCounter = taskCounter + 1 RETURNING taskCounter` ภายใน Transaction เดียวกับการ `INSERT Task` จึงรับประกันว่าเลข `WS-1`, `WS-2` ไม่ชนกันแม้ยิงพร้อมกันหลายคำขอ
4. **Fractional Indexing (`BoardColumn.position`, `Task.position`)**
   - เก็บลำดับเป็น lexicographical string (เช่น `"a0"`, `"a0V"`, `"a1"`) เมื่อลากการ์ดแทรกระหว่างสองใบ จะคำนวณค่ากลางและ `UPDATE` แค่แถวเดียว ไม่ต้องรันเลขใหม่ทั้งคอลัมน์
5. **Optimistic Locking (`Task.version`)**
   - ทุกการอัปเดตสำคัญใช้เงื่อนไข `WHERE id = :id AND version = :expectedVersion` พร้อมเพิ่ม `version = version + 1` หากจำนวนแถวที่อัปเดตเป็น `0` ระบบรู้ทันทีว่าเกิดการแก้ไขชนกันและตอบ `409 Conflict`
6. **Task Dependency Graph (`TaskDependency`)**
   - บังคับ Unique `(taskId, dependsOnTaskId)` และ `CHECK (taskId <> dependsOnTaskId)` พร้อมตรวจจับ Cycle ในระดับ Service ภายใน Transaction ด้วยการดึงกราฟของ `projectId` เดียวกันมาวิ่ง DFS ก่อนบันทึก

---

## 3. แผนการทำ Indexes หลัก (Database Indexing Plan)

| ตาราง | Index / Unique Constraint | จุดประสงค์ |
|---|---|---|
| `OrganizationMember` | `UNIQUE(orgId, userId)`, `INDEX(userId)` | ตรวจสิทธิ์เข้าองค์กรและดึงรายชื่อองค์กรของผู้ใช้ |
| `Workspace` | `UNIQUE(orgId, slug)`, `INDEX(orgId)` | ค้นหา Workspace ตาม URL slug ภายในองค์กร |
| `Project` | `UNIQUE(orgId, key)`, `INDEX(workspaceId, archivedAt)` | ค้นหาโปรเจกต์ตามรหัสย่อและแสดงรายการใน Workspace |
| `Task` | `UNIQUE(projectId, number)` | ค้นหางานด้วยรหัสเช่น `WS-42` |
| `Task` | `INDEX(columnId, deletedAt, position)` | โหลดกระดาน Kanban เรียงตามลำดับในแต่ละคอลัมน์ |
| `Task` | `INDEX(projectId, deletedAt, status/priority/assigneeId, createdAt)` | รองรับ Filter & Cursor Pagination ในหน้ารายการงาน |
| `TaskDependency` | `UNIQUE(taskId, dependsOnTaskId)`, `INDEX(projectId)`, `INDEX(dependsOnTaskId)` | โหลดกราฟตรวจ Cycle และเช็กงานที่ถูกบล็อก |
| `ActivityLog` | `INDEX(projectId, createdAt DESC)`, `INDEX(orgId, createdAt DESC)` | เปิดดูประวัติกิจกรรมแบบแบ่งหน้าอย่างรวดเร็ว |
| `Notification` | `INDEX(userId, readAt, createdAt DESC)` | นับจำนวนแจ้งเตือนที่ยังไม่อ่านและดึงรายการล่าสุด |
