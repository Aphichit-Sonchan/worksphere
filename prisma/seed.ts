import "dotenv/config";
import { generateInitialPositions } from "../src/lib/ordering/fractional-index";
import { getDb } from "../src/server/db";
import { hashPassword } from "../src/server/modules/auth/crypto";

const DEMO_PASSWORD = process.env.DEMO_SEED_PASSWORD ?? "DemoPass#2026";

async function main() {
  const db = getDb();
  const now = new Date();
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  // 1. สร้างหรืออัปเดตบัญชี Demo ทั้ง 3 บทบาทแบบ Idempotent (ไม่กระทบข้อมูลผู้ใช้อื่น)
  const [owner, member, viewer] = await Promise.all([
    db.user.upsert({
      where: { email: "owner@demo.worksphere.io" },
      update: { name: "Narin Rattana (Owner)", passwordHash, emailVerifiedAt: now },
      create: {
        email: "owner@demo.worksphere.io",
        name: "Narin Rattana (Owner)",
        passwordHash,
        locale: "th",
        emailVerifiedAt: now,
      },
    }),
    db.user.upsert({
      where: { email: "member@demo.worksphere.io" },
      update: { name: "Pimchanok Dev (Member)", passwordHash, emailVerifiedAt: now },
      create: {
        email: "member@demo.worksphere.io",
        name: "Pimchanok Dev (Member)",
        passwordHash,
        locale: "th",
        emailVerifiedAt: now,
      },
    }),
    db.user.upsert({
      where: { email: "viewer@demo.worksphere.io" },
      update: { name: "Alex Stakeholder (Viewer)", passwordHash, emailVerifiedAt: now },
      create: {
        email: "viewer@demo.worksphere.io",
        name: "Alex Stakeholder (Viewer)",
        passwordHash,
        locale: "en",
        emailVerifiedAt: now,
      },
    }),
  ]);

  // 2. สร้างองค์กรตัวอย่าง `worksphere-demo`
  const org = await db.organization.upsert({
    where: { slug: "worksphere-demo" },
    update: { name: "WorkSphere Demo Corp", deletedAt: null, suspendedAt: null },
    create: {
      name: "WorkSphere Demo Corp",
      slug: "worksphere-demo",
      createdById: owner.id,
    },
  });

  await Promise.all([
    db.organizationMember.upsert({
      where: { orgId_userId: { orgId: org.id, userId: owner.id } },
      update: { role: "ORG_OWNER" },
      create: { orgId: org.id, userId: owner.id, role: "ORG_OWNER" },
    }),
    db.organizationMember.upsert({
      where: { orgId_userId: { orgId: org.id, userId: member.id } },
      update: { role: "MEMBER" },
      create: { orgId: org.id, userId: member.id, role: "MEMBER" },
    }),
    db.organizationMember.upsert({
      where: { orgId_userId: { orgId: org.id, userId: viewer.id } },
      update: { role: "MEMBER" },
      create: { orgId: org.id, userId: viewer.id, role: "MEMBER" },
    }),
  ]);

  // 3. สร้าง 2 Workspaces (Product Engineering & Design Growth)
  const [engWs, growthWs] = await Promise.all([
    db.workspace.upsert({
      where: { orgId_slug: { orgId: org.id, slug: "product-engineering" } },
      update: { name: "Product Engineering" },
      create: {
        orgId: org.id,
        name: "Product Engineering",
        slug: "product-engineering",
        description: "Core SaaS backend, realtime collaboration, and infrastructure",
        createdById: owner.id,
      },
    }),
    db.workspace.upsert({
      where: { orgId_slug: { orgId: org.id, slug: "design-growth" } },
      update: { name: "Design & Growth" },
      create: {
        orgId: org.id,
        name: "Design & Growth",
        slug: "design-growth",
        description: "Design system, enterprise UX, and customer onboarding",
        createdById: owner.id,
      },
    }),
  ]);

  await Promise.all([
    db.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: engWs.id, userId: owner.id } },
      update: { role: "WORKSPACE_ADMIN" },
      create: { workspaceId: engWs.id, userId: owner.id, role: "WORKSPACE_ADMIN" },
    }),
    db.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: engWs.id, userId: member.id } },
      update: { role: "MEMBER" },
      create: { workspaceId: engWs.id, userId: member.id, role: "MEMBER" },
    }),
    db.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: engWs.id, userId: viewer.id } },
      update: { role: "MEMBER" },
      create: { workspaceId: engWs.id, userId: viewer.id, role: "MEMBER" },
    }),
    db.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: growthWs.id, userId: owner.id } },
      update: { role: "WORKSPACE_ADMIN" },
      create: { workspaceId: growthWs.id, userId: owner.id, role: "WORKSPACE_ADMIN" },
    }),
  ]);

  // 4. สร้าง Flagship Demo Project พร้อมคอลัมน์ Kanban, Tags, Tasks, Subtasks และ Dependency
  const existingProject = await db.project.findUnique({
    where: { orgId_key: { orgId: org.id, key: "WS" } },
  });

  if (!existingProject) {
    const project = await db.project.create({
      data: {
        orgId: org.id,
        workspaceId: engWs.id,
        key: "WS",
        name: "WorkSphere v1 Enterprise Launch",
        description: "End-to-end multi-tenant SaaS release board with DAG dependencies",
        taskCounter: 5,
        createdById: owner.id,
      },
    });

    await db.projectMember.createMany({
      data: [
        { projectId: project.id, userId: owner.id, role: "PROJECT_MANAGER" },
        { projectId: project.id, userId: member.id, role: "MEMBER" },
        { projectId: project.id, userId: viewer.id, role: "VIEWER" },
      ],
    });

    const colPos = generateInitialPositions(4);
    const [colTodo, colProg, colRev, colDone] = await Promise.all([
      db.boardColumn.create({
        data: { projectId: project.id, name: "To Do", category: "TODO", position: colPos[0]! },
      }),
      db.boardColumn.create({
        data: {
          projectId: project.id,
          name: "In Progress",
          category: "IN_PROGRESS",
          position: colPos[1]!,
          wipLimit: 5,
        },
      }),
      db.boardColumn.create({
        data: {
          projectId: project.id,
          name: "In Review",
          category: "IN_PROGRESS",
          position: colPos[2]!,
        },
      }),
      db.boardColumn.create({
        data: { projectId: project.id, name: "Done", category: "DONE", position: colPos[3]! },
      }),
    ]);

    const [tagSec, tagPerf] = await Promise.all([
      db.tag.create({ data: { projectId: project.id, name: "Security", color: "#dc2626" } }),
      db.tag.create({ data: { projectId: project.id, name: "Performance", color: "#2563eb" } }),
    ]);

    const taskPos = generateInitialPositions(4);
    const in3Days = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const in5Days = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);

    const t1 = await db.task.create({
      data: {
        orgId: org.id,
        projectId: project.id,
        columnId: colDone.id,
        number: 1,
        title: "Implement Argon2id + Refresh Token Family Reuse Detection",
        description: "Custom HttpOnly session architecture with automatic family revocation.",
        priority: "HIGHEST",
        position: taskPos[0]!,
        assigneeId: owner.id,
        reporterId: owner.id,
        completedAt: now,
      },
    });

    const t2 = await db.task.create({
      data: {
        orgId: org.id,
        projectId: project.id,
        columnId: colProg.id,
        number: 2,
        title: "Verify 4-Tier RBAC & Cross-Tenant Isolation Matrix",
        description: "Ensure cross-organization probes consistently return 404 NOT_FOUND.",
        priority: "HIGH",
        position: taskPos[1]!,
        assigneeId: member.id,
        reporterId: owner.id,
        dueDate: in3Days,
      },
    });

    const t3 = await db.task.create({
      data: {
        orgId: org.id,
        projectId: project.id,
        columnId: colTodo.id,
        number: 3,
        title: "Publish Production Load Benchmark & Security Sign-off",
        description: "Blocked until WS-2 completes security verification.",
        priority: "HIGH",
        position: taskPos[2]!,
        assigneeId: owner.id,
        reporterId: owner.id,
        dueDate: in5Days,
      },
    });

    await db.task.create({
      data: {
        orgId: org.id,
        projectId: project.id,
        columnId: colRev.id,
        number: 4,
        title: "Tune Composite Indexes & Read-Through Cache TTLs",
        priority: "MEDIUM",
        position: taskPos[3]!,
        assigneeId: member.id,
        reporterId: owner.id,
        dueDate: in3Days,
      },
    });

    // Subtask under WS-2
    await db.task.create({
      data: {
        orgId: org.id,
        projectId: project.id,
        columnId: colDone.id,
        parentId: t2.id,
        number: 5,
        title: "Audit Socket.IO project room authorization handshake",
        priority: "MEDIUM",
        position: taskPos[0]!,
        assigneeId: member.id,
        reporterId: owner.id,
        completedAt: now,
      },
    });

    await db.taskTag.createMany({
      data: [
        { taskId: t1.id, tagId: tagSec.id },
        { taskId: t2.id, tagId: tagSec.id },
        { taskId: t3.id, tagId: tagPerf.id },
      ],
    });

    // Dependency: WS-3 depends on WS-2
    await db.taskDependency.create({
      data: {
        projectId: project.id,
        taskId: t3.id,
        dependsOnTaskId: t2.id,
        createdById: owner.id,
      },
    });

    await db.comment.create({
      data: {
        orgId: org.id,
        taskId: t2.id,
        authorId: owner.id,
        body: "All 43 automated tests and 100-VU load checks are green. Ready for final review!",
      },
    });

    await db.activityLog.create({
      data: {
        orgId: org.id,
        projectId: project.id,
        taskId: t1.id,
        actorId: owner.id,
        action: "demo.project_seeded",
        metadata: { key: "WS-1", note: "Demo showcase initialized" },
      },
    });
  }

  console.log(
    JSON.stringify(
      {
        seeded: true,
        organization: { name: org.name, slug: org.slug },
        accounts: [
          { role: "ORG_OWNER / PROJECT_MANAGER", email: owner.email, password: DEMO_PASSWORD },
          { role: "MEMBER", email: member.email, password: DEMO_PASSWORD },
          { role: "PROJECT_VIEWER", email: viewer.email, password: DEMO_PASSWORD },
        ],
      },
      null,
      2,
    ),
  );

  await db.$disconnect();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
