import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Project, ProjectMember, User } from '@prisma/client';
import { hasRole } from '@tcs/shared-types';
import { prisma } from '../prisma.js';
import { canAccessProject, isProjectCreator } from '../services/access.js';

const projectBodySchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
});

const addMemberBodySchema = z.object({
  email: z.string().email(),
});

type ProjectRow = Project & {
  createdBy?: User;
  members?: (ProjectMember & { user: User })[];
  _count?: { campaigns: number; members: number };
};

function serializeProject(project: ProjectRow) {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    deletedAt: project.deletedAt,
    campaignCount: project._count?.campaigns,
    memberCount: project._count?.members,
    createdBy: project.createdBy
      ? { id: project.createdBy.id, email: project.createdBy.email, displayName: project.createdBy.displayName }
      : undefined,
    members: project.members?.map((m) => ({
      userId: m.user.id,
      email: m.user.email,
      displayName: m.user.displayName,
      addedAt: m.addedAt,
    })),
  };
}

/** Only the project's creator (or an admin) manages it — see docs/functional.md. */
async function requireProjectCreator(request: FastifyRequest, project: Project): Promise<boolean> {
  return isProjectCreator(project, request.user!.sub, hasRole(request.user!.roles, 'admin'));
}

export function registerProjectRoutes(app: FastifyInstance): void {
  app.get('/api/projects', { preHandler: app.requireAuth }, async (request) => {
    const isAdmin = hasRole(request.user!.roles, 'admin');
    const projects = await prisma.project.findMany({
      where: {
        deletedAt: null,
        ...(isAdmin
          ? {}
          : {
              OR: [
                { createdById: request.user!.sub },
                { members: { some: { userId: request.user!.sub } } },
              ],
            }),
      },
      include: { createdBy: true, _count: { select: { campaigns: true, members: true } } },
      orderBy: { updatedAt: 'desc' },
    });
    return projects.map(serializeProject);
  });

  app.post('/api/projects', { preHandler: app.requireRole('editor') }, async (request, reply) => {
    const body = projectBodySchema.parse(request.body);
    const project = await prisma.project.create({
      data: { name: body.name, description: body.description, createdById: request.user!.sub },
      include: { createdBy: true, _count: { select: { campaigns: true, members: true } } },
    });
    return reply.code(201).send(serializeProject(project));
  });

  app.get('/api/projects/:id', { preHandler: app.requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await canAccessProject(request, id))) {
      return reply.code(403).send({ error: 'you do not have access to this project' });
    }
    const project = await prisma.project.findUnique({
      where: { id },
      include: {
        createdBy: true,
        members: { include: { user: true }, orderBy: { addedAt: 'asc' } },
        _count: { select: { campaigns: true, members: true } },
      },
    });
    if (!project) return reply.code(404).send({ error: 'project not found' });
    return serializeProject(project);
  });

  app.put('/api/projects/:id', { preHandler: app.requireRole('editor') }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await prisma.project.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) return reply.code(404).send({ error: 'project not found' });
    if (!(await requireProjectCreator(request, existing))) {
      return reply.code(403).send({ error: 'only the project creator or an admin can modify it' });
    }
    const body = projectBodySchema.partial().parse(request.body);
    const project = await prisma.project.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
      },
      include: { createdBy: true, _count: { select: { campaigns: true, members: true } } },
    });
    return serializeProject(project);
  });

  app.delete('/api/projects/:id', { preHandler: app.requireRole('editor') }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await prisma.project.findUnique({
      where: { id },
      include: { _count: { select: { campaigns: true } } },
    });
    if (!existing || existing.deletedAt) return reply.code(404).send({ error: 'project not found' });
    if (!(await requireProjectCreator(request, existing))) {
      return reply.code(403).send({ error: 'only the project creator or an admin can delete it' });
    }
    if (existing._count.campaigns > 0) {
      // Logical delete: campaigns keep their project association and history.
      await prisma.project.update({ where: { id }, data: { deletedAt: new Date() } });
      return { deleted: 'soft' };
    }
    await prisma.project.delete({ where: { id } });
    return { deleted: 'hard' };
  });

  app.post('/api/projects/:id/members', { preHandler: app.requireRole('editor') }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await prisma.project.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) return reply.code(404).send({ error: 'project not found' });
    if (!(await requireProjectCreator(request, existing))) {
      return reply.code(403).send({ error: 'only the project creator or an admin can manage members' });
    }
    const body = addMemberBodySchema.parse(request.body);
    const user = await prisma.user.findUnique({ where: { email: body.email } });
    if (!user) return reply.code(404).send({ error: `no user with email "${body.email}"` });
    const member = await prisma.projectMember.upsert({
      where: { projectId_userId: { projectId: id, userId: user.id } },
      create: { projectId: id, userId: user.id },
      update: {},
      include: { user: true },
    });
    return reply.code(201).send({
      userId: member.user.id,
      email: member.user.email,
      displayName: member.user.displayName,
      addedAt: member.addedAt,
    });
  });

  app.delete(
    '/api/projects/:id/members/:userId',
    { preHandler: app.requireRole('editor') },
    async (request, reply) => {
      const { id, userId } = request.params as { id: string; userId: string };
      const existing = await prisma.project.findUnique({ where: { id } });
      if (!existing || existing.deletedAt) return reply.code(404).send({ error: 'project not found' });
      if (!(await requireProjectCreator(request, existing))) {
        return reply.code(403).send({ error: 'only the project creator or an admin can manage members' });
      }
      await prisma.projectMember.deleteMany({ where: { projectId: id, userId } });
      return { removed: true };
    },
  );
}
