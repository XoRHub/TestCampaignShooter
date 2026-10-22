import type { FastifyRequest } from 'fastify';
import { hasRole } from '@tcs/shared-types';
import { prisma } from '../prisma.js';

export interface ProjectAccessInfo {
  createdById: string;
  members: { userId: string }[];
}

/**
 * Pure predicate — a project is visible to its creator, its members, and
 * admins (who bypass project restrictions entirely, same as they already
 * bypass campaign ownership). Testable without a database.
 */
export function hasProjectAccess(project: ProjectAccessInfo, userId: string, isAdmin: boolean): boolean {
  return isAdmin || project.createdById === userId || project.members.some((m) => m.userId === userId);
}

/**
 * Pure predicate — only the project's creator (or an admin) can manage it
 * (edit/delete/members) or mutate any campaign inside it. A regular member
 * mutating a campaign still goes through the usual editor-owns-it rule
 * (see `canMutate` in routes/campaigns.ts) — this only covers the extra
 * "project creator can mutate everything in their project" grant.
 */
export function isProjectCreator(project: { createdById: string }, userId: string, isAdmin: boolean): boolean {
  return isAdmin || project.createdById === userId;
}

async function loadProjectAccessInfo(projectId: string): Promise<ProjectAccessInfo | null> {
  return prisma.project.findUnique({
    where: { id: projectId },
    select: { createdById: true, members: { select: { userId: true } } },
  });
}

/** Whether the requester can see/use a project (list its campaigns, attach a campaign to it, etc.). */
export async function canAccessProject(request: FastifyRequest, projectId: string): Promise<boolean> {
  const isAdmin = hasRole(request.user!.roles, 'admin');
  if (isAdmin) return true;
  const project = await loadProjectAccessInfo(projectId);
  return project !== null && hasProjectAccess(project, request.user!.sub, isAdmin);
}

/** Whether the requester can see a campaign: no project = open to any viewer, same as before projects existed. */
export async function canAccessCampaign(
  request: FastifyRequest,
  campaign: { projectId: string | null },
): Promise<boolean> {
  if (!campaign.projectId) return true;
  return canAccessProject(request, campaign.projectId);
}

/** Whether the requester is the project's creator (or admin) — full mutation rights over the project and everything in it. */
export async function canMutateCampaignInProject(request: FastifyRequest, projectId: string): Promise<boolean> {
  const isAdmin = hasRole(request.user!.roles, 'admin');
  if (isAdmin) return true;
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { createdById: true } });
  return project !== null && isProjectCreator(project, request.user!.sub, isAdmin);
}

/** Prisma `where` filter fragment for listing only the campaigns a non-admin user may see. */
export function campaignVisibilityFilter(userId: string) {
  return {
    OR: [
      { projectId: null },
      { project: { createdById: userId } },
      { project: { members: { some: { userId } } } },
    ],
  };
}
