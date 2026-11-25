-- CreateIndex
CREATE INDEX "Task_orgId_deletedAt_completedAt_idx" ON "Task"("orgId", "deletedAt", "completedAt");

-- CreateIndex
CREATE INDEX "Task_dueDate_completedAt_deletedAt_idx" ON "Task"("dueDate", "completedAt", "deletedAt");
