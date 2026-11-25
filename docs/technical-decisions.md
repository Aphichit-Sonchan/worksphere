# WorkSphere — Engineering Deep-Dives & Resume Portfolio (`WS-805`)

เอกสารฉบับนี้รวบรวมเหตุผลเชิงวิศวกรรม (Architecture Decision Records & Technical Deep-Dives) สำหรับใช้ตอบคำถามในการสัมภาษณ์งานตำแหน่ง **Full-Stack / Backend Software Engineer** พร้อมข้อความสรุปผลงานภาษาอังกฤษสำหรับใส่ใน Resume

---

## Part 1: Technical Write-ups (เจาะลึกการแก้ปัญหาเชิงระบบ 5 ประเด็นหลัก)

### 1. Multi-Tenant Isolation & 4-Tier RBAC (`404` vs `403` Boundary)
- **โจทย์ปัญหา**: ในระบบ SaaS ที่มีหลายองค์กรอยู่บนฐานข้อมูลเดียวกัน (Shared Database, Shared Schema) หากเขียน Query พลาดเพียงจุดเดียว หรือคืน `403 Forbidden` เมื่อผู้ใช้เดารหัส `projectId` ขององค์กรอื่น จะเกิดช่องโหว่ IDOR และการรั่วไหลของการมีอยู่ของข้อมูล (Resource Enumeration)
- **การออกแบบ**:
  - Denormalize คอลัมน์ `orgId` ลงในตารางระดับลึกทุกตาราง (`Workspace`, `Project`, `Task`, `Comment`, `Attachment`, `ActivityLog`, `Notification`) เพื่อให้ทั้งชั้น Application และ Composite Index กั้นขอบเขตข้อมูลระดับ Tenant ได้ในคิวรีเดียว
  - รวมศูนย์การตรวจสิทธิ์ไว้ที่ `TenancyService.resolveOrgContext` และ `ProjectTaskService.resolveProjectContext`: หากผู้ใช้ไม่ได้เป็นสมาชิกขององค์กรเจ้าของทรัพยากร ระบบตอบ **`404 NOT_FOUND` เสมอ** ส่วน `403 FORBIDDEN` จะตอบเฉพาะกรณีที่เป็นสมาชิกในโปรเจกต์/องค์กรนั้นจริงแต่บทบาทไม่ถึงเกณฑ์ (เช่น `VIEWER` พยายามลบงาน)

### 2. Custom Authentication & Refresh Token Family Reuse Detection
- **โจทย์ปัญหา**: การสร้างระบบ Auth เองโดยไม่พึ่งพา Auth-as-a-Service ต้องรับมือทั้งการขโมยรหัสผ่านจากฐานข้อมูล การขโมยโทเคนผ่าน XSS/CSRF และการนำ Refresh Token เก่าที่หลุดออกไปกลับมาสวมรอย
- **การออกแบบ**:
  - แฮชรหัสผ่านด้วย **Argon2id** (`memoryCost: 19456 KiB, timeCost: 2`) พร้อม `verifyDummyPassword` ป้องกัน Timing Enumeration เมื่อกรอกอีเมลที่ไม่มีในระบบ
  - แยกโทเคนเป็น 2 ส่วนในคุกกี้ `HttpOnly; SameSite=Lax`: `ws_access` อายุสั้น 15 นาที (HMAC-SHA256 พร้อมตรวจสถานะเซสชันจริง) และ `ws_refresh` อายุ 30 วันที่เก็บเฉพาะค่า **SHA-256 Hash** ลงตาราง `Session`
  - ผูกทุกเซสชันในการล็อกอินครั้งเดียวกันด้วย `familyId` เมื่อหมุนเวียนโทเคน (`POST /api/v1/auth/refresh`) เซสชันเดิมจะถูกบันทึก `replacedByTokenHash` ทันที หากผู้โจมตีนำ Refresh Token ตัวเก่าที่ถูกใช้ไปแล้วมายิงซ้ำ ระบบตรวจพบ **Token Reuse** และสั่ง **เพิกถอนทุกเซสชันใน `familyId` นั้นทันที** เพื่อบังคับให้ทั้งผู้โจมตีและเจ้าของบัญชีล็อกอินใหม่อย่างปลอดภัย

### 3. Kanban Ordering (Base-36 Fractional Indexing), Concurrency (`version`) & DAG Cycle Prevention
- **โจทย์ปัญหา**:
  1. หากเก็บลำดับการ์ดเป็นเลขจำนวนเต็ม `1, 2, 3, ...` การลากการ์ดใบเดียวขึ้นบนสุดของคอลัมน์ที่มี 500 งานต้อง `UPDATE` ทั้ง 500 แถว
  2. หากผู้ใช้ 2 คนแก้ไขการ์ดเดียวกันพร้อมกัน คนที่กดบันทึกทีหลังจะทับข้อมูลของคนแรก (Lost Update)
  3. หากผูกความสัมพันธ์งานเป็นวงกลม (`A -> B -> C -> A`) งานทั้งหมดในวงจรจะไม่สามารถปิดสถานะ `DONE` ได้เลย
- **การออกแบบ**:
  - **Base-36 Lexicographical Fractional Indexing (`0-9a-z`)**: คำนวณค่ากึ่งกลางระหว่างสตริงสองตำแหน่ง (เช่น `"a"` กับ `"c"` ได้ `"b"`, `"a"` กับ `"b"` ได้ `"ai"`) ทำให้การลากวางการ์ดอัปเดตเพียง **1 แถว (`O(1)`)** และเลือกใช้ตัวพิมพ์เล็ก Base-36 เพื่อให้ลำดับการเรียงใน JavaScript, ASCII และ UTF-8 Collation ของ PostgreSQL ตรงกัน 100%
  - **Optimistic Locking**: ทุกการแก้ไขหรือย้ายการ์ดแนบ `version` ปัจจุบันไปทำ Atomic `updateMany WHERE id = ? AND version = ?` พร้อมเพิ่ม `version + 1` หากผลลัพธ์ `count === 0` ระบบคืน `409 VERSION_CONFLICT` พร้อมสถานะการ์ดล่าสุดทันที
  - **DFS Cycle Detection**: ก่อนบันทึก `TaskDependency` ระบบจำลองกราฟความสัมพันธ์ในหน่วยความจำแล้วเดิน Depth-First Search เพื่อตรวจว่ามีเส้นทางย้อนกลับมายังงานต้นทางหรือไม่ หากพบจะปฏิเสธด้วย `409 DEPENDENCY_CYCLE`

### 4. Read-Through Caching, Deterministic Invalidation & Resilient Job Queue
- **การออกแบบ**:
  - สร้าง `CacheAdapter` (`RedisCacheAdapter` + `MemoryCacheAdapter`) ครอบข้อมูลที่ถูกอ่านซ้ำสูง (`org:{orgId}:members`, `proj:{projectId}:meta`, `proj:{projectId}:stats`, `org:{orgId}:dashboard:{userId}`) ด้วย helper `rememberCached` และสั่งล้างคีย์เฉพาะจุดทันทีเมื่อเกิด Mutation ที่เกี่ยวข้อง
  - สร้าง `ResilientJobQueue` ที่ทำงานร่วมกับ **BullMQ** บน Redis ใน Production และสลับมาใช้ In-Process Exponential Backoff Retry Engine อัตโนมัติในโหมดพัฒนา พร้อมป้องกันการทำงานซ้ำด้วย `jobId` คงที่ (Idempotency) และการสกัดกั้น CSV Formula Injection (`=,+,-,@`) ในไฟล์ Export

### 5. Cross-Region Cloud PostgreSQL Query & Transaction Tuning
- **โจทย์ปัญหา**: เมื่อแอปพลิเคชันเชื่อมต่อกับ Serverless PostgreSQL ข้ามภูมิภาคที่มีค่า RTT ราว `~250 ms` ต่อคำสั่ง การวนลูปยิง SQL ใน Interactive Transaction จะเกิดปัญหา N+1 และชนเพดานเวลา `5000 ms` (`P2028`)
- **การแก้ปัญหา**:
  - เปลี่ยนการเขียนข้อมูลหลายแถวในลูปเป็นคำสั่งชุดเดียว (`createMany`, `createManyAndReturn`)
  - ย้ายการดึงข้อมูลซ้อนลึก (`include` ขนาดใหญ่หลังเขียนเสร็จ) ออกมานอกขอบเขต Interactive Transaction เพื่อให้ถือ Database Lock สั้นที่สุด
  - สร้าง Composite Indexes ให้ตรงกับเงื่อนไข `WHERE + ORDER BY` ของหน้าบอร์ดและหน้า Dashboard Analytics ทุกจุด

---

## Part 2: English Resume Project Bullets (พร้อมคัดลอกใส่ Resume)

> **WorkSphere — Multi-Tenant SaaS Project Management & Collaboration Platform**
> *Next.js 16 (TypeScript), PostgreSQL (Prisma 7), Redis, BullMQ, Socket.IO, Tailwind CSS, Vitest, Playwright*
>
> - **Architected a custom multi-tenant SaaS platform from scratch** (Jira + Trello hybrid) enforcing strict tenant isolation (`404` non-enumeration boundaries) and a 4-tier server-side RBAC permission matrix across System, Organization, Workspace, and Project scopes.
> - **Engineered production-grade authentication without third-party auth providers**, implementing Argon2id password hashing, short-lived HMAC-SHA256 access cookies, SHA-256 hashed refresh token rotation, session family reuse detection, and CSRF origin guards.
> - **Built a concurrency-safe Kanban & workflow engine** featuring `O(1)` Base-36 fractional indexing for drag-and-drop ordering, `version`-based optimistic locking (`409 VERSION_CONFLICT` recovery), and DFS-based directed acyclic graph (DAG) cycle detection for task dependencies.
> - **Implemented real-time collaboration and resilient background processing** using authenticated Socket.IO project rooms, online presence tracking, BullMQ exponential-backoff workers, CSV formula-injection-safe task exports, and Redis read-through caching with deterministic invalidation.
> - **Validated reliability across 43 automated unit, integration, and security tests plus Playwright E2E flows**, achieving **1,850+ req/sec throughput (`p50 = 45 ms`, `0%` error rate)** under a 100-concurrent-virtual-user load benchmark.

---

## Part 3: โครงการเล่าโปรเจกต์เวลาสัมภาษณ์งาน (3-Minute Interview Pitch)

1. **Problem & Scope (30 วินาที)**: *"ผมสร้าง WorkSphere ซึ่งเป็นแพลตฟอร์มบริหารโปรเจกต์แบบ Multi-tenant SaaS ผสมจุดเด่นของ Jira และ Trello โดยตั้งใจเขียนระบบ Auth, 4-Tier RBAC, Optimistic Locking และ Realtime Sync เองทั้งหมดเพื่อเข้าใจกลไกความปลอดภัยและความถูกต้องของข้อมูลในระดับ Production ลึกทุกชั้น"*
2. **Core Engineering Highlights (90 วินาที)**:
   - ชี้ให้เห็นการแยกข้อมูลข้ามองค์กร (`orgId` denormalization + `404` boundary)
   - อธิบายการทำงานของ Refresh Token Family Reuse Detection เมื่อโทเคนรั่วไหล
   - สาธิตการลากการ์ดด้วย Fractional Indexing (`O(1)` update), การป้องกันการชนกันด้วยคอลัมน์ `version` และการตรวจจับวงจรปิดของ Task Dependency ด้วย DFS
3. **Performance & Quality Proof (60 วินาที)**:
   - โชว์ผลชุดทดสอบอัตโนมัติ 43 ข้อที่ครอบคลุมตารางสิทธิ์ทั้ง 4 บทบาท รวมถึงการปรับจูน Composite Indexes + Read-Through Cache ที่รับโหลดจำลอง 100 ผู้ใช้งานพร้อมกันได้ที่ `1,850 req/sec` โดยไม่มีคำขอพังแม้แต่รายการเดียว
