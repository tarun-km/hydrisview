import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../context.js';
import { inquiries } from '../db/schema.js';
import { withSystem } from '../db/tenant.js';
import { sha256 } from '../core/crypto.js';
import { badRequest } from '../core/errors.js';
import { sendMail } from '../core/services.js';

export const CONSENT_VERSION = '2026-10';

/**
 * Public website enquiries. Spam controls: per-IP rate limit, honeypot field and a
 * minimum form-fill time. IP addresses are stored only as salted hashes.
 */
export async function publicRoutes(app: FastifyInstance, ctx: Ctx, opts: { relaxedLimits?: boolean }) {
  app.post('/public/inquiries', { config: { rateLimit: { max: opts.relaxedLimits ? 10_000 : 5, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const body = z.object({
      kind: z.enum(['contact', 'demo']),
      name: z.string().trim().min(2).max(120),
      email: z.string().trim().toLowerCase().pipe(z.email()),
      company: z.string().trim().max(160).optional(),
      jobTitle: z.string().trim().max(120).optional(),
      phone: z.string().trim().max(40).regex(/^[0-9+()\-\s.]*$/, 'Use digits and + ( ) - only').optional(),
      siteCount: z.enum(['1', '2-5', '6-20', '20+']).optional(),
      message: z.string().trim().max(4000).optional(),
      consent: z.literal(true, { error: 'Consent is required to contact you' }),
      website: z.string().max(0).optional(), // honeypot - must stay empty
      startedAt: z.number().int().optional(),
    }).parse(req.body);
    const elapsed = body.startedAt ? Date.now() - body.startedAt : Infinity;
    if (elapsed < 2500) throw badRequest('too_fast', 'Please take a moment to complete the form');
    await withSystem(ctx.db, async (tx) => {
      await tx.insert(inquiries).values({
        kind: body.kind, name: body.name, email: body.email, company: body.company, jobTitle: body.jobTitle, phone: body.phone, siteCount: body.siteCount,
        message: body.message, consent: true, consentVersion: CONSENT_VERSION, ipHash: sha256(`${ctx.config.JWT_SECRET.slice(0, 16)}:${req.ip}`), userAgent: req.headers['user-agent']?.slice(0, 200),
      });
      await sendMail(tx, 'sales@hydris.local', `New ${body.kind === 'demo' ? 'demo request' : 'enquiry'} from ${body.company ?? body.name}`, `${body.name} <${body.email}>\n${body.message ?? ''}`);
    });
    return reply.code(201).send({ ok: true });
  });
}
