import { z } from "zod";

export const projectKeyField = z
  .string()
  .trim()
  .toUpperCase()
  .min(2, "Project key must be 2–6 characters")
  .max(6, "Project key must be 2–6 characters")
  .regex(/^[A-Z][A-Z0-9]*$/, "Project key must start with a letter and contain A–Z or 0–9");

export const createProjectSchema = z.object({
  key: projectKeyField,
  name: z.string().trim().min(2, "Project name must be at least 2 characters").max(100),
  description: z.string().trim().max(1000).optional(),
});

export const updateProjectSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  archived: z.boolean().optional(),
});

export const upsertProjectMemberSchema = z.object({
  userId: z.string().trim().min(1),
  role: z.enum(["PROJECT_MANAGER", "MEMBER", "VIEWER"]).default("MEMBER"),
});

export const updateProjectMemberRoleSchema = z.object({
  role: z.enum(["PROJECT_MANAGER", "MEMBER", "VIEWER"]),
});

export const createColumnSchema = z.object({
  name: z.string().trim().min(1).max(48),
  category: z.enum(["TODO", "IN_PROGRESS", "DONE"]).default("TODO"),
  afterColumnId: z.string().trim().min(1).optional(),
  wipLimit: z.number().int().min(1).max(200).nullable().optional(),
});

export const updateColumnSchema = z.object({
  name: z.string().trim().min(1).max(48).optional(),
  category: z.enum(["TODO", "IN_PROGRESS", "DONE"]).optional(),
  wipLimit: z.number().int().min(1).max(200).nullable().optional(),
});

export const createTagSchema = z.object({
  name: z.string().trim().min(1).max(36),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Color must be a 6-digit hex code")
    .default("#2563eb"),
});

export const taskPriorityEnum = z.enum(["LOWEST", "LOW", "MEDIUM", "HIGH", "HIGHEST"]);

export const createTaskSchema = z.object({
  title: z.string().trim().min(1, "Task title is required").max(200),
  description: z.string().trim().max(10000).optional(),
  columnId: z.string().trim().min(1).optional(),
  priority: taskPriorityEnum.default("MEDIUM"),
  assigneeId: z.string().trim().min(1).nullable().optional(),
  dueDate: z.iso.datetime().nullable().optional(),
  parentId: z.string().trim().min(1).nullable().optional(),
  tagIds: z.array(z.string().trim().min(1)).max(12).optional(),
});

export const createSubtaskSchema = z.object({
  title: z.string().trim().min(1, "Subtask title is required").max(200),
  priority: taskPriorityEnum.default("MEDIUM"),
  assigneeId: z.string().trim().min(1).nullable().optional(),
});

export const updateTaskSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(10000).nullable().optional(),
  columnId: z.string().trim().min(1).optional(),
  priority: taskPriorityEnum.optional(),
  assigneeId: z.string().trim().min(1).nullable().optional(),
  dueDate: z.iso.datetime().nullable().optional(),
  tagIds: z.array(z.string().trim().min(1)).max(12).optional(),
  version: z.number().int().min(1).optional(),
});

export const moveTaskSchema = z.object({
  columnId: z.string().trim().min(1),
  beforeTaskId: z.string().trim().min(1).nullable().optional(),
  afterTaskId: z.string().trim().min(1).nullable().optional(),
  version: z.number().int().min(1).optional(),
});

export const addDependencySchema = z.object({
  dependsOnTaskId: z.string().trim().min(1),
});

export const taskQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  columnId: z.string().trim().optional(),
  priority: z.string().trim().optional(), // comma-separated เช่น "HIGH,HIGHEST"
  assigneeId: z.string().trim().optional(), // userId หรือ "unassigned"
  tagId: z.string().trim().optional(),
  includeSubtasks: z.enum(["0", "1"]).optional().default("0"),
  sort: z
    .enum(["position:asc", "createdAt:desc", "createdAt:asc", "dueDate:asc", "priority:desc"])
    .optional()
    .default("position:asc"),
  cursor: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});

export const createCommentSchema = z.object({
  body: z.string().trim().min(1, "Comment cannot be empty").max(5000),
});

export const updateCommentSchema = z.object({
  body: z.string().trim().min(1, "Comment cannot be empty").max(5000),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type CreateColumnInput = z.infer<typeof createColumnSchema>;
export type UpdateColumnInput = z.infer<typeof updateColumnSchema>;
export type CreateTagInput = z.infer<typeof createTagSchema>;
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type CreateSubtaskInput = z.infer<typeof createSubtaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type MoveTaskInput = z.infer<typeof moveTaskSchema>;
export type TaskQueryInput = z.infer<typeof taskQuerySchema>;
