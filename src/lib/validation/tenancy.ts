import { z } from "zod";

export const slugField = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, "Slug must be at least 2 characters")
  .max(48, "Slug must be at most 48 characters")
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must contain lowercase letters, numbers, and hyphens");

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2, "Organization name must be at least 2 characters").max(80),
  slug: slugField,
});

export const updateOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(80),
});

export const updateOrgMemberRoleSchema = z.object({
  role: z.enum(["ORG_OWNER", "ORG_ADMIN", "MEMBER"]),
});

export const createInvitationSchema = z.object({
  email: z.string().trim().toLowerCase().email("Invalid email address").max(255),
  role: z.enum(["ORG_OWNER", "ORG_ADMIN", "MEMBER"]).default("MEMBER"),
  workspaceId: z.string().trim().min(1).optional(),
});

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(2, "Workspace name must be at least 2 characters").max(80),
  slug: slugField,
  description: z.string().trim().max(500).optional(),
});

export const updateWorkspaceSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  archived: z.boolean().optional(),
});

export const addWorkspaceMemberSchema = z.object({
  userId: z.string().trim().min(1),
  role: z.enum(["WORKSPACE_ADMIN", "MEMBER"]).default("MEMBER"),
});

export const adminUpdateOrganizationSchema = z.object({
  suspended: z.boolean(),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceSchema>;
export type AddWorkspaceMemberInput = z.infer<typeof addWorkspaceMemberSchema>;
