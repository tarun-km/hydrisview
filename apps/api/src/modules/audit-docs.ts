/**
 * Audit document scans: capture (glasses or console) → OCR structuring → optional vision
 * refinement → dual verification (machine cross-check per value, then human field review
 * and an independent approval) → searchable PDF.
 *
 * Every review action is appended to audit_document_events; corrections keep the value as
 * first extracted (`extracted`) so history is never overwritten.
 */
import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import {
  agreementOf, agreementScore, applyPlausibility, checkTables, crossCheck, inferType, keyValuesFromLines, normalizeValue, reviewProgress, splitUnit, structureFromOcr,
  guessTitle, type AuditExtraction, type AuditField, type AuditFigure, type AuditTable, type BBox, type OcrLine, type OcrReading,
} from '@hydris/domain';
import type { Ctx } from '../context';
import { authenticate, tenant } from '../context';
import { auditDocumentEvents, auditDocumentPages, auditDocuments, organizations, sites, users } from '../db/schema';
import type { Tx } from '../db/client';
import { withSystem } from '../db/tenant';
import { badRequest, conflict, forbidden, notFound } from '../core/errors';
import { has, requirePerm, requireSite, siteAllowed, type Principal } from '../core/principal';
import { audit } from '../core/services';
import { buildAuditPdf } from '../core/audit-pdf';
import { processDocument, softcopyFor } from '../core/doc-pipeline';
import { buildSoftcopyDocx, buildSoftcopyPdf } from '../core/softcopy-render';
import { describeVisionError, extractWithVision, visionAvailable, VISION_ENGINE, type VisionExtraction } from '../core/vision-extract';
import { demoShared } from '../core/demo-shared';
import { ensureGuest } from '../core/demo-guests';

const MAX_PAGES = 6;
const MAX_PAGE_BYTES = 900 * 1024;

const bbox = z.tuple([z.number(), z.number(), z.number(), z.number()]);
const word = z.object({ text: z.string().max(200), conf: z.number(), bbox });
const line = z.object({ text: z.string().max(2000), conf: z.number(), bbox, words: z.array(word).max(400) });
const reading = z.object({ engine: z.string().max(40), text: z.string().max(60_000), conf: z.number(), lines: z.array(line).max(600) });
const pageInput = z.object({
  mime: z.enum(['image/jpeg', 'image/png']),
  data: z.string().max(Math.ceil(MAX_PAGE_BYTES * 1.37)),
  width: z.number().int().min(50).max(6000),
  height: z.number().int().min(50).max(6000),
  readings: z.array(reading).max(4).default([]),
  figures: z.array(z.object({ id: z.string().max(40), page: z.number().int(), bbox, kind: z.enum(['photo', 'diagram', 'chart', 'signature', 'stamp', 'logo', 'other']), caption: z.string().max(200) })).max(20).optional(),
});

type Doc = typeof auditDocuments.$inferSelect;

import { mergeVision } from './audit-docs-merge';
export { mergeVision };

function extractionFromOcr(readings: OcrReading[][], title: string, figures: AuditFigure[][] = []): AuditExtraction {
  const out: AuditExtraction = { title, docType: 'general', summary: '', pages: [], fields: [], tables: [], figures: [], warnings: [] };
  readings.forEach((r, i) => {
    const s = structureFromOcr(i + 1, r, (figures[i] ?? []).map((f, j) => ({ ...f, id: `p${i + 1}-g${j + 1}`, page: i + 1 })));
    out.fields.push(...s.fields);
    out.tables.push(...s.tables);
    out.figures.push(...s.figures);
    out.pages.push(s.text);
    const conf = r[0]?.conf ?? 0;
    if (conf < 60) out.warnings.push(`Page ${i + 1}: low OCR confidence (${Math.round(conf)}%) - check lighting and focus or rescan.`);
  });
  if (!out.fields.length && !out.tables.length) out.warnings.push('No labelled values or tables were detected - review the page text.');
  return out;
}

// ------------------------------------------------------------------ routes
export async function auditDocRoutes(app: FastifyInstance, ctx: Ctx) {
  const auth = { preHandler: authenticate(ctx) };
  const idParam = z.object({ id: z.uuid() });

  // ---- demo mode: documents shared across serverless instances
  const SHARE_TTL = 60 * 60 * 24 * 30;
  const idxKey = (org: string) => `auditdoc:index:${org}`;
  const docKey = (id: string) => `auditdoc:doc:${id}`;
  type Snapshot = { doc: Record<string, unknown>; pages: Record<string, unknown>[]; events: Record<string, unknown>[] };

  async function share(tx: Tx, id: string) {
    if (!ctx.config.demoMode) return;
    const [doc] = await tx.select().from(auditDocuments).where(eq(auditDocuments.id, id));
    if (!doc) return;
    const pages = await tx.select().from(auditDocumentPages).where(eq(auditDocumentPages.documentId, id));
    const events = await tx.select().from(auditDocumentEvents).where(eq(auditDocumentEvents.documentId, id));
    await demoShared().set(docKey(id), { doc, pages, events } satisfies Snapshot as unknown, SHARE_TTL);
    const idx = (await demoShared().get<string[]>(idxKey(doc.orgId))) ?? [];
    if (!idx.includes(id)) await demoShared().set(idxKey(doc.orgId), [id, ...idx].slice(0, 200), SHARE_TTL);
  }

  const revive = <T>(r: Record<string, unknown>, dates: string[]): T => {
    const o = { ...r };
    for (const d of dates) if (typeof o[d] === 'string') o[d] = new Date(o[d] as string);
    return o as T;
  };

  /** Pull documents written on other instances into this one (system context). */
  async function hydrate(orgId: string, onlyId?: string) {
    if (!ctx.config.demoMode) return;
    const ids = onlyId ? [onlyId] : ((await demoShared().get<string[]>(idxKey(orgId))) ?? []);
    if (!ids.length) return;
    await withSystem(ctx.db, async (tx) => {
      const local = new Map((await tx.select({ id: auditDocuments.id, revision: auditDocuments.revision }).from(auditDocuments).where(inArray(auditDocuments.id, ids))).map((r) => [r.id, r.revision]));
      for (const id of ids) {
        const snap = await demoShared().get<Snapshot>(docKey(id));
        if (!snap) continue;
        const doc = revive<Doc>(snap.doc, ['createdAt', 'updatedAt', 'verifiedAt', 'approvedAt']);
        if (doc.orgId !== orgId) continue;
        const have = local.get(id);
        if (have !== undefined && have >= doc.revision) continue;
        for (const u of [doc.capturedBy, doc.verifiedBy, doc.approvedBy, ...snap.events.map((e) => e.userId as string | null)]) if (u) await ensureGuest(tx, u);
        const row = { ...doc, deviceId: null };
        if (have === undefined) {
          await tx.insert(auditDocuments).values(row).onConflictDoNothing();
          for (const p of snap.pages) await tx.insert(auditDocumentPages).values(revive<typeof auditDocumentPages.$inferInsert>(p, ['createdAt'])).onConflictDoNothing();
        } else {
          await tx.update(auditDocuments).set(row).where(eq(auditDocuments.id, id));
        }
        const known = new Set((await tx.select({ id: auditDocumentEvents.id }).from(auditDocumentEvents).where(eq(auditDocumentEvents.documentId, id))).map((e) => e.id));
        for (const e of snap.events) if (!known.has(e.id as string)) await tx.insert(auditDocumentEvents).values({ ...revive<typeof auditDocumentEvents.$inferInsert>(e, ['createdAt']), deviceId: null }).onConflictDoNothing();
      }
    });
  }

  async function load(tx: Tx, p: Principal, id: string): Promise<Doc> {
    const [d] = await tx.select().from(auditDocuments).where(eq(auditDocuments.id, id));
    if (!d) throw notFound('Audit document');
    if (d.siteId) requireSite(p, d.siteId, 'Audit document');
    return d;
  }

  async function event(tx: Tx, p: Principal, documentId: string, action: string, e: { target?: string; before?: unknown; after?: unknown; note?: string | null } = {}) {
    await tx.insert(auditDocumentEvents).values({ orgId: p.orgId, documentId, userId: p.userId, deviceId: p.deviceId ?? null, action, target: e.target ?? null, before: e.before ?? null, after: e.after ?? null, note: e.note ?? null });
  }

  const publish = (d: Pick<Doc, 'id' | 'orgId' | 'siteId' | 'status' | 'title'>) =>
    ctx.bus.publish({ type: 'auditdoc.updated', orgId: d.orgId, siteId: d.siteId, permission: 'auditdoc.read', payload: { id: d.id, status: d.status, title: d.title } });

  const summary = (d: Doc & { siteName?: string | null; capturedByName?: string | null }) => {
    const prog = reviewProgress(d.extraction);
    return {
      id: d.id, title: d.title, docType: d.docType, status: d.status, siteId: d.siteId, siteName: d.siteName ?? null, pageCount: d.pageCount, capturedVia: d.capturedVia,
      capturedBy: d.capturedByName ?? null, createdAt: d.createdAt, updatedAt: d.updatedAt, engines: d.engines, aiStatus: d.aiStatus,
      agreement: agreementScore(d.extraction.fields), fields: d.extraction.fields.length, tables: d.extraction.tables.length, figures: d.extraction.figures.length,
      review: prog, attention: d.extraction.fields.filter((f) => f.agreement === 'mismatch' || f.conf < 0.75).length,
    };
  };

  app.get('/audit-docs/capabilities', auth, async () => ({ vision: visionAvailable(), visionEngine: VISION_ENGINE, maxPages: MAX_PAGES, maxPageBytes: MAX_PAGE_BYTES }));

  app.get('/audit-docs', auth, async (req) => {
    const p = req.principal!;
    requirePerm(p, 'auditdoc.read');
    const q = z.object({ status: z.enum(['processing', 'in_review', 'verified', 'approved', 'rejected']).optional(), mine: z.enum(['true', 'false']).optional() }).parse(req.query);
    await hydrate(p.orgId);
    return tenant(ctx, req, async (tx) => {
      const rows = await tx.select({ d: auditDocuments, siteName: sites.name, capturedByName: users.name }).from(auditDocuments)
        .leftJoin(sites, eq(sites.id, auditDocuments.siteId)).leftJoin(users, eq(users.id, auditDocuments.capturedBy))
        .where(and(q.status ? eq(auditDocuments.status, q.status) : undefined, q.mine === 'true' ? eq(auditDocuments.capturedBy, p.userId) : undefined))
        .orderBy(desc(auditDocuments.createdAt)).limit(200);
      return rows.filter((r) => !r.d.siteId || siteAllowed(p, r.d.siteId)).map((r) => summary({ ...r.d, siteName: r.siteName, capturedByName: r.capturedByName }));
    });
  });

  app.get('/audit-docs/:id', auth, async (req) => {
    const { id } = idParam.parse(req.params);
    const p = req.principal!;
    requirePerm(p, 'auditdoc.read');
    await hydrate(p.orgId, id);
    return tenant(ctx, req, async (tx) => {
      const d = await load(tx, p, id);
      const pages = await tx.select({ pageNo: auditDocumentPages.pageNo, width: auditDocumentPages.width, height: auditDocumentPages.height, mime: auditDocumentPages.mime })
        .from(auditDocumentPages).where(eq(auditDocumentPages.documentId, id)).orderBy(asc(auditDocumentPages.pageNo));
      const events = await tx.select({ e: auditDocumentEvents, userName: users.name }).from(auditDocumentEvents).leftJoin(users, eq(users.id, auditDocumentEvents.userId))
        .where(eq(auditDocumentEvents.documentId, id)).orderBy(desc(auditDocumentEvents.createdAt));
      const ids = [d.capturedBy, d.verifiedBy, d.approvedBy].filter((x): x is string => !!x);
      const names = new Map(ids.length ? (await tx.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids))).map((u) => [u.id, u.name]) : []);
      const [site] = d.siteId ? await tx.select({ name: sites.name }).from(sites).where(eq(sites.id, d.siteId)) : [];
      return {
        ...summary({ ...d, siteName: site?.name ?? null, capturedByName: d.capturedBy ? names.get(d.capturedBy) ?? null : null }),
        extraction: d.extraction, revision: d.revision, aiError: d.aiError,
        verifiedBy: d.verifiedBy ? { id: d.verifiedBy, name: names.get(d.verifiedBy) ?? null, at: d.verifiedAt } : null,
        approvedBy: d.approvedBy ? { id: d.approvedBy, name: names.get(d.approvedBy) ?? null, at: d.approvedAt } : null,
        rejectedReason: d.rejectedReason, pages,
        events: events.map((r) => ({ id: r.e.id, action: r.e.action, target: r.e.target, before: r.e.before, after: r.e.after, note: r.e.note, at: r.e.createdAt, user: r.userName, viaGlasses: !!r.e.deviceId })),
        permissions: { review: has(p, 'auditdoc.verify') || has(p, 'auditdoc.capture'), verify: has(p, 'auditdoc.verify'), approve: has(p, 'auditdoc.approve') },
      };
    });
  });

  app.get('/audit-docs/:id/pages/:pageNo', auth, async (req, reply) => {
    const { id, pageNo } = z.object({ id: z.uuid(), pageNo: z.coerce.number().int().min(1) }).parse(req.params);
    const p = req.principal!;
    requirePerm(p, 'auditdoc.read');
    await hydrate(p.orgId, id);
    const pg = await tenant(ctx, req, async (tx) => {
      await load(tx, p, id);
      const [r] = await tx.select().from(auditDocumentPages).where(and(eq(auditDocumentPages.documentId, id), eq(auditDocumentPages.pageNo, pageNo)));
      return r;
    });
    if (!pg) throw notFound('Page');
    return reply.header('content-type', pg.mime).header('cache-control', 'private, max-age=3600').send(Buffer.from(pg.data, 'base64'));
  });

  app.get('/audit-docs/:id/pdf', auth, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const p = req.principal!;
    requirePerm(p, 'auditdoc.read');
    await hydrate(p.orgId, id);
    const input = await tenant(ctx, req, async (tx) => {
      const d = await load(tx, p, id);
      const pages = await tx.select().from(auditDocumentPages).where(eq(auditDocumentPages.documentId, id)).orderBy(asc(auditDocumentPages.pageNo));
      const ids = [d.capturedBy, d.verifiedBy, d.approvedBy].filter((x): x is string => !!x);
      const names = new Map(ids.length ? (await tx.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids))).map((u) => [u.id, u.name]) : []);
      const [org] = await tx.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, d.orgId));
      const [site] = d.siteId ? await tx.select({ name: sites.name }).from(sites).where(eq(sites.id, d.siteId)) : [];
      const n = (u: string | null) => (u ? names.get(u) ?? null : null);
      return {
        title: d.title, docType: d.docType, status: d.status, orgName: org?.name ?? '', siteName: site?.name ?? null, capturedBy: n(d.capturedBy), capturedVia: d.capturedVia, createdAt: d.createdAt,
        verifiedBy: n(d.verifiedBy), verifiedAt: d.verifiedAt, approvedBy: n(d.approvedBy), approvedAt: d.approvedAt, rejectedReason: d.rejectedReason, engines: d.engines, extraction: d.extraction, pages,
      };
    });
    const pdf = await buildAuditPdf(input);
    const name = input.title.replace(/[^A-Za-z0-9 _-]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'audit-document';
    return reply.header('content-type', 'application/pdf').header('content-disposition', `attachment; filename="${name}.pdf"`).send(Buffer.from(pdf));
  });

  // ---- capture (glasses or console)
  app.post('/audit-docs', { ...auth, bodyLimit: 8 * 1024 * 1024 }, async (req, reply) => {
    const p = req.principal!;
    requirePerm(p, 'auditdoc.capture');
    const body = z.object({
      title: z.string().trim().max(160).optional(),
      siteId: z.uuid().optional(),
      assetId: z.uuid().optional(),
      pages: z.array(pageInput).min(1).max(MAX_PAGES),
      source: z.enum(['mobile']).optional(),
    }).parse(req.body);
    for (const pg of body.pages) {
      const bytes = Buffer.from(pg.data, 'base64');
      if (bytes.length > MAX_PAGE_BYTES) throw badRequest('page_too_large', 'Each page image must be under 900 KB');
      const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
      const isPng = bytes.subarray(0, 4).toString('hex') === '89504e47';
      if ((pg.mime === 'image/jpeg' && !isJpeg) || (pg.mime === 'image/png' && !isPng)) throw badRequest('invalid_image', 'Page data is not a valid JPEG/PNG image');
    }
    const doc = await tenant(ctx, req, async (tx) => {
      const siteId = body.siteId ?? (p.siteIds[0] ?? (await tx.select({ id: sites.id }).from(sites).orderBy(asc(sites.name)).limit(1))[0]?.id ?? null);
      if (siteId) requireSite(p, siteId, 'Site');
      const readings = body.pages.map((pg) => pg.readings as OcrReading[]);
      const extraction = extractionFromOcr(readings, body.title || 'Scanned audit document', body.pages.map((pg) => pg.figures ?? []));
      const title = body.title || guessTitle(readings) || `Audit scan ${new Date().toISOString().slice(0, 10)}`;
      extraction.title = title;
      const [d] = await tx.insert(auditDocuments).values({
        orgId: p.orgId, siteId, assetId: body.assetId ?? null, title, status: 'in_review', pageCount: body.pages.length, extraction,
        engines: [...new Set(readings.flat().map((r) => r.engine))], aiStatus: 'pending', // server pipeline (clean page, server OCR, vision, fusion) runs next
        capturedBy: p.userId, capturedVia: p.kind === 'device' ? 'glasses' : body.source ?? 'console', deviceId: p.deviceId ?? null,
      }).returning();
      for (const [i, pg] of body.pages.entries()) {
        await tx.insert(auditDocumentPages).values({ orgId: p.orgId, documentId: d!.id, pageNo: i + 1, mime: pg.mime, data: pg.data, width: pg.width, height: pg.height, ocr: { readings: pg.readings } });
      }
      await event(tx, p, d!.id, 'captured', { after: { pages: body.pages.length, fields: extraction.fields.length, tables: extraction.tables.length, engines: d!.engines } });
      await audit(tx, p, { orgId: p.orgId, action: 'auditdoc.captured', entityType: 'audit_document', entityId: d!.id, summary: title, ip: req.ip });
      await share(tx, d!.id);
      return d!;
    });
    publish(doc);
    return reply.code(201).send(summary(doc));
  });

  /**
   * Server processing (clean A4 page, server OCR, vision, fusion). Runs after every upload (the
   * capturing client calls it; `/enhance` is the original name) and from the console "Re-process".
   * The fused extraction replaces the current one only while no review decision has been made;
   * afterwards only the page images / engine readings used by the soft copy are refreshed.
   */
  const processHandler = async (req: import('fastify').FastifyRequest) => {
    const { id } = idParam.parse(req.params);
    const p = req.principal!;
    if (!has(p, 'auditdoc.capture') && !has(p, 'auditdoc.verify')) throw forbidden();
    await hydrate(p.orgId, id);
    const { d, pages } = await tenant(ctx, req, async (tx) => {
      const d = await load(tx, p, id);
      const pages = await tx.select().from(auditDocumentPages).where(eq(auditDocumentPages.documentId, id)).orderBy(asc(auditDocumentPages.pageNo));
      return { d, pages };
    });
    const res = await processDocument(pages, { title: d.title, deviceEngine: d.capturedVia === 'mobile' ? 'mlkit:android' : 'ocr:device' });
    const vision = res.report.engines.find((e) => e.engine.startsWith('vision'));
    const aiStatus = !visionAvailable() ? 'unavailable' as const : vision?.ok ? 'done' as const : 'failed' as const;
    const replace = d.status === 'in_review' && reviewProgress(d.extraction).done === 0 && reviewProgress(d.extraction).flagged === 0 && res.engines.length > 0;
    const out = await tenant(ctx, req, async (tx) => {
      for (const [i, pg] of pages.entries()) await tx.update(auditDocumentPages).set({ ocr: res.pageOcr[i] }).where(and(eq(auditDocumentPages.documentId, id), eq(auditDocumentPages.pageNo, pg.pageNo)));
      const keepTitle = !(d.title.startsWith('Audit scan') || d.title === 'Scanned audit document');
      const [u] = await tx.update(auditDocuments).set({
        ...(replace ? { extraction: { ...res.extraction, title: keepTitle ? d.title : res.extraction.title || d.title }, docType: res.extraction.docType, title: keepTitle ? d.title : res.extraction.title || d.title } : {}),
        engines: [...new Set([...d.engines, ...res.engines])], aiStatus, aiError: vision && !vision.ok ? vision.message ?? null : null, revision: d.revision + 1, updatedAt: new Date(),
      }).where(and(eq(auditDocuments.id, id), eq(auditDocuments.revision, d.revision))).returning();
      if (!u) throw conflict('stale', 'The document changed while it was being processed');
      await event(tx, p, id, 'processed', { after: { engines: res.report.engines, steps: res.report.steps, replaced: replace, fields: res.extraction.fields.length, tables: res.extraction.tables.length, agreement: agreementScore(res.extraction.fields) } });
      await share(tx, id);
      return u;
    });
    publish(out);
    return { ...summary(out), report: res.report, engineStats: res.extraction.engineStats, replaced: replace };
  };
  app.post('/audit-docs/:id/process', { ...auth, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, processHandler);
  app.post('/audit-docs/:id/enhance', { ...auth, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, processHandler);

  // ---- soft copy: re-typeset document model (JSON for the console preview), DOCX and clean PDF
  async function softcopyOf(req: import('fastify').FastifyRequest) {
    const { id } = idParam.parse(req.params);
    const p = req.principal!;
    requirePerm(p, 'auditdoc.read');
    await hydrate(p.orgId, id);
    const { d, pages } = await tenant(ctx, req, async (tx) => {
      const d = await load(tx, p, id);
      const pages = await tx.select().from(auditDocumentPages).where(eq(auditDocumentPages.documentId, id)).orderBy(asc(auditDocumentPages.pageNo));
      return { d, pages };
    });
    const model = await softcopyFor(d, pages);
    const name = d.title.replace(/[^A-Za-z0-9 _-]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'audit-document';
    return { model, name };
  }
  app.get('/audit-docs/:id/softcopy', auth, async (req) => (await softcopyOf(req)).model);
  app.get('/audit-docs/:id/softcopy.docx', auth, async (req, reply) => {
    const { model, name } = await softcopyOf(req);
    const buf = await buildSoftcopyDocx(model);
    return reply.header('content-type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document').header('content-disposition', `attachment; filename="${name}.docx"`).send(buf);
  });
  app.get('/audit-docs/:id/softcopy.pdf', auth, async (req, reply) => {
    const { model, name } = await softcopyOf(req);
    const pdf = await buildSoftcopyPdf(model);
    return reply.header('content-type', 'application/pdf').header('content-disposition', `attachment; filename="${name}-clean.pdf"`).send(Buffer.from(pdf));
  });
  /** Clean (preprocessed) page image, when the server pipeline has produced one. */
  app.get('/audit-docs/:id/pages/:pageNo/clean', auth, async (req, reply) => {
    const { id, pageNo } = z.object({ id: z.uuid(), pageNo: z.coerce.number().int().min(1) }).parse(req.params);
    const p = req.principal!;
    requirePerm(p, 'auditdoc.read');
    await hydrate(p.orgId, id);
    const pg = await tenant(ctx, req, async (tx) => {
      await load(tx, p, id);
      const [r] = await tx.select().from(auditDocumentPages).where(and(eq(auditDocumentPages.documentId, id), eq(auditDocumentPages.pageNo, pageNo)));
      return r;
    });
    if (!pg) throw notFound('Page');
    const clean = (pg.ocr as { clean?: { mime: string; data: string } } | null)?.clean;
    return reply.header('content-type', clean?.mime ?? pg.mime).header('cache-control', 'private, max-age=300').send(Buffer.from(clean?.data ?? pg.data, 'base64'));
  });

  // ---- human review: confirm / correct / flag one field or table
  app.patch('/audit-docs/:id/items/:itemId', auth, async (req) => {
    const { id, itemId } = z.object({ id: z.uuid(), itemId: z.string().min(1).max(80) }).parse(req.params);
    const p = req.principal!;
    if (!has(p, 'auditdoc.verify') && !has(p, 'auditdoc.capture')) throw forbidden();
    const body = z.object({
      action: z.enum(['confirm', 'correct', 'flag', 'reset']),
      value: z.string().max(2000).optional(),
      unit: z.string().max(20).nullable().optional(),
      header: z.array(z.string().max(200)).max(40).optional(),
      rows: z.array(z.array(z.string().max(500)).max(40)).max(400).optional(),
      note: z.string().trim().max(500).optional(),
      expectedRevision: z.number().int().optional(),
    }).parse(req.body);
    await hydrate(p.orgId, id);
    const doc = await tenant(ctx, req, async (tx) => {
      const d = await load(tx, p, id);
      if (d.status === 'approved') throw conflict('locked', 'Approved documents are locked');
      if (body.expectedRevision !== undefined && body.expectedRevision !== d.revision) throw conflict('stale', 'Someone else updated this document - reload to continue');
      const x: AuditExtraction = structuredClone(d.extraction);
      const now = new Date().toISOString();
      const field = x.fields.find((f) => f.id === itemId);
      const table = field ? null : x.tables.find((t) => t.id === itemId);
      if (!field && !table) throw notFound('Item');
      const before = structuredClone(field ?? table);
      if (field) {
        if (body.action === 'correct') {
          if (body.value === undefined) throw badRequest('value_required', 'Enter the corrected value');
          field.extracted ??= field.value;
          field.value = normalizeValue(body.value);
          if (body.unit !== undefined) field.unit = body.unit;
          field.status = normalizeValue(body.value) === field.extracted ? 'confirmed' : 'corrected';
        } else field.status = body.action === 'confirm' ? 'confirmed' : body.action === 'flag' ? 'flagged' : 'pending';
        field.reviewedBy = body.action === 'reset' ? null : p.userId;
        field.reviewedAt = body.action === 'reset' ? null : now;
        field.note = body.note ?? field.note ?? null;
      } else if (table) {
        if (body.action === 'correct') {
          if (!body.rows) throw badRequest('rows_required', 'Send the corrected table rows');
          table.header = body.header ?? table.header;
          table.rows = body.rows;
          table.status = 'corrected';
        } else table.status = body.action === 'confirm' ? 'confirmed' : body.action === 'flag' ? 'flagged' : 'pending';
      }
      // Any change after verification re-opens the review (verification applies to what was reviewed).
      const reopen = d.status === 'verified' || d.status === 'rejected';
      const [u] = await tx.update(auditDocuments).set({
        extraction: x, revision: d.revision + 1, updatedAt: new Date(),
        ...(reopen ? { status: 'in_review' as const, verifiedBy: null, verifiedAt: null, approvedBy: null, approvedAt: null, rejectedReason: null } : {}),
      }).where(and(eq(auditDocuments.id, id), eq(auditDocuments.revision, d.revision))).returning();
      if (!u) throw conflict('stale', 'Someone else updated this document - reload to continue');
      await event(tx, p, id, `item.${body.action}`, { target: itemId, before, after: field ?? table, note: body.note });
      if (reopen) await event(tx, p, id, 'review.reopened', { note: 'Changed after verification' });
      await share(tx, id);
      return u;
    });
    publish(doc);
    return { revision: doc.revision, status: doc.status, review: reviewProgress(doc.extraction), item: doc.extraction.fields.find((f) => f.id === itemId) ?? doc.extraction.tables.find((t) => t.id === itemId) };
  });

  /** Confirm every remaining item in one go (only items whose engines agree and are confident). */
  app.post('/audit-docs/:id/confirm-agreed', auth, async (req) => {
    const { id } = idParam.parse(req.params);
    const p = req.principal!;
    if (!has(p, 'auditdoc.verify') && !has(p, 'auditdoc.capture')) throw forbidden();
    await hydrate(p.orgId, id);
    const doc = await tenant(ctx, req, async (tx) => {
      const d = await load(tx, p, id);
      if (d.status !== 'in_review') throw conflict('not_in_review', 'Only documents in review can be bulk-confirmed');
      const x: AuditExtraction = structuredClone(d.extraction);
      const now = new Date().toISOString();
      const ids: string[] = [];
      for (const f of x.fields) {
        if (f.status === 'pending' && f.sources.length > 1 && f.agreement === 'match' && f.conf >= 0.8) {
          f.status = 'confirmed';
          f.reviewedBy = p.userId;
          f.reviewedAt = now;
          ids.push(f.id);
        }
      }
      if (!ids.length) return d;
      const [u] = await tx.update(auditDocuments).set({ extraction: x, revision: d.revision + 1, updatedAt: new Date() }).where(and(eq(auditDocuments.id, id), eq(auditDocuments.revision, d.revision))).returning();
      if (!u) throw conflict('stale', 'Someone else updated this document - reload to continue');
      await event(tx, p, id, 'items.confirm_agreed', { after: { ids }, note: `${ids.length} values where independent engines agree` });
      await share(tx, id);
      return u;
    });
    publish(doc);
    return { revision: doc.revision, review: reviewProgress(doc.extraction) };
  });

  // ---- verification 1: reviewer signs off the field review
  app.post('/audit-docs/:id/verify', auth, async (req) => {
    const { id } = idParam.parse(req.params);
    const p = req.principal!;
    requirePerm(p, 'auditdoc.verify');
    if (p.kind !== 'user') throw forbidden('Verification is signed in the console');
    const { note } = z.object({ note: z.string().trim().max(500).optional() }).parse(req.body ?? {});
    await hydrate(p.orgId, id);
    const doc = await tenant(ctx, req, async (tx) => {
      const d = await load(tx, p, id);
      if (d.status !== 'in_review') throw conflict('not_in_review', 'This document is not awaiting review');
      const prog = reviewProgress(d.extraction);
      if (prog.flagged) throw badRequest('flagged_items', `${prog.flagged} flagged item(s) must be resolved first`);
      if (!prog.complete) throw badRequest('review_incomplete', `${prog.pending} item(s) still need review`);
      const [u] = await tx.update(auditDocuments).set({ status: 'verified', verifiedBy: p.userId, verifiedAt: new Date(), revision: d.revision + 1, updatedAt: new Date() }).where(and(eq(auditDocuments.id, id), eq(auditDocuments.revision, d.revision))).returning();
      if (!u) throw conflict('stale', 'Someone else updated this document - reload to continue');
      await event(tx, p, id, 'verified', { note, after: prog });
      await audit(tx, p, { orgId: p.orgId, action: 'auditdoc.verified', entityType: 'audit_document', entityId: id, summary: d.title, ip: req.ip });
      await share(tx, id);
      return u;
    });
    publish(doc);
    return { status: doc.status, revision: doc.revision };
  });

  // ---- verification 2: an independent approver (not the verifier) accepts or rejects
  app.post('/audit-docs/:id/approve', auth, async (req) => {
    const { id } = idParam.parse(req.params);
    const p = req.principal!;
    requirePerm(p, 'auditdoc.approve');
    if (p.kind !== 'user') throw forbidden('Approval is signed in the console');
    const body = z.object({ decision: z.enum(['approve', 'reject']), note: z.string().trim().max(500).optional() }).parse(req.body);
    if (body.decision === 'reject' && !body.note) throw badRequest('reason_required', 'Give a reason for rejecting');
    await hydrate(p.orgId, id);
    const doc = await tenant(ctx, req, async (tx) => {
      const d = await load(tx, p, id);
      if (d.status !== 'verified') throw conflict('not_verified', 'The field review must be verified first');
      // Four-eyes rule. Demo tenants (one person exploring alone) may self-approve; it is recorded as such.
      const sameUser = d.verifiedBy === p.userId;
      if (sameUser && !p.isDemoOrg) throw forbidden('A different person must approve what you verified');
      const [u] = await tx.update(auditDocuments).set({
        status: body.decision === 'approve' ? 'approved' : 'rejected', approvedBy: p.userId, approvedAt: new Date(), rejectedReason: body.decision === 'reject' ? body.note! : null,
        revision: d.revision + 1, updatedAt: new Date(),
      }).where(and(eq(auditDocuments.id, id), eq(auditDocuments.revision, d.revision))).returning();
      if (!u) throw conflict('stale', 'Someone else updated this document - reload to continue');
      await event(tx, p, id, body.decision === 'approve' ? 'approved' : 'rejected', { note: [body.note, sameUser ? 'Self-approved (demo tenant)' : null].filter(Boolean).join(' · ') || null });
      await audit(tx, p, { orgId: p.orgId, action: `auditdoc.${body.decision === 'approve' ? 'approved' : 'rejected'}`, entityType: 'audit_document', entityId: id, summary: d.title, ip: req.ip });
      await share(tx, id);
      return u;
    });
    publish(doc);
    return { status: doc.status, revision: doc.revision };
  });

  app.patch('/audit-docs/:id', auth, async (req) => {
    const { id } = idParam.parse(req.params);
    const p = req.principal!;
    if (!has(p, 'auditdoc.verify') && !has(p, 'auditdoc.capture')) throw forbidden();
    const body = z.object({ title: z.string().trim().min(2).max(160) }).parse(req.body);
    await hydrate(p.orgId, id);
    return tenant(ctx, req, async (tx) => {
      const d = await load(tx, p, id);
      if (d.status === 'approved') throw conflict('locked', 'Approved documents are locked');
      const [u] = await tx.update(auditDocuments).set({ title: body.title, revision: d.revision + 1, updatedAt: new Date() }).where(eq(auditDocuments.id, id)).returning();
      await event(tx, p, id, 'renamed', { before: d.title, after: body.title });
      await share(tx, id);
      return { title: u!.title, revision: u!.revision };
    });
  });

}

