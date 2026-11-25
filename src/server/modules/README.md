# Domain Modules (`src/server/modules`)

แต่ละโฟลเดอร์ย่อยแบ่งตามขอบเขตทางธุรกิจ (Domain-Driven Modular Services):
- `auth/` — Registration, Login, Refresh Token Rotation, Email Verification, Password Reset (Phase 2)
- `organization/` — Organization CRUD, Memberships, Invitations (Phase 3)
- `workspace/` — Workspace CRUD & Members (Phase 3)
- `project/` — Project CRUD, Archive, Columns, Tags, Members (Phase 4)
- `task/` — Task & Subtask CRUD, Kanban Move, Dependency Cycle Detection, Search/Filter (Phase 4)
- `comment/` — Comments, `@mention` parsing, Attachments (Phase 4–5)
- `notification/` — Notification Center & Activity/Audit Logs (Phase 5)
- `analytics/` — Organization Dashboard & Project Analytics (Phase 7)
