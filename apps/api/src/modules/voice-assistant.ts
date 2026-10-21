/**
 * "Hey Hydris" voice assistant: spoken questions → answers grounded in the caller's own account.
 *
 * Every number comes from the tenant database through tools scoped to the caller (user or paired
 * glasses: RLS + site scope). Two engines:
 *   - Claude (claude-opus-5-5, tool use) when an Anthropic credential is configured: free-form
 *     questions, multi-step lookups, natural phrasing;
 *   - a deterministic intent engine otherwise (and as fallback): measurements, alarms, my work,
 *     asset status, procedures. It never guesses: unknown questions get "I can't answer that".
 * Answers are short and written to be spoken.
 */
import type { FastifyInstance } from 'fastify';
import Anthropic from '@anthropic-ai/sdk';
import { and, asc, desc, eq, ilike, inArray, isNull, notInArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { MEASURANDS, MEASURAND_DEFS, detectMeasurand, freshness, normalizeUtterance, type Measurand } from '@hydris/domain';
import type { Ctx } from '../context';
import { authenticate, tenant } from '../context';
import { alarmEvents, assets, documents, inspections, maintenanceTasks, sensors, sites } from '../db/schema';
import type { Tx } from '../db/client';
import { siteScope, type Principal } from '../core/principal';
import { visionAvailable } from '../core/vision-extract';

export const ASSISTANT_MODEL = 'claude-opus-5-5';

const ago = (ts: Date | null) => {
  if (!ts) return 'with no recent reading';
  const s = Math.max(0, Math.round((Date.now() - ts.getTime()) / 1000));
  if (s < 2) return 'just now';
  if (s < 90) return `${s} seconds ago`;
  if (s < 5400) return `${Math.round(s / 60)} minutes ago`;
  return `${Math.round(s / 3600)} hours ago`;
};
const fmt = (v: number, m: Measurand) => v.toFixed(Math.min(MEASURAND_DEFS[m].decimals, 2));
const spokenUnit = (u: string) => (u === 'pH' ? '' : ` ${u.replace('mg/L', 'milligrams per litre').replace('m3/h', 'cubic metres per hour').replace('°C', 'degrees Celsius').replace('%', 'percent')}`);

// ------------------------------------------------------------------ data tools (tenant-scoped)
export interface Fact { label: string; value: string; unit?: string | null; at?: string | null; source?: string | null; ref?: string }

async function readings(tx: Tx, p: Principal, a: { measurand?: Measurand | null; query?: string | null; siteId?: string | null }) {
  const rows = await tx.select({ s: sensors, assetTag: assets.tag, assetName: assets.name, siteName: sites.name }).from(sensors)
    .leftJoin(assets, eq(assets.id, sensors.assetId)).leftJoin(sites, eq(sites.id, sensors.siteId))
    .where(and(siteScope(p, sensors.siteId), isNull(sensors.archivedAt), eq(sensors.enabled, true),
      a.measurand ? eq(sensors.measurand, a.measurand) : undefined,
      a.siteId ? eq(sensors.siteId, a.siteId) : undefined,
      a.query ? or(ilike(sensors.tag, `%${a.query}%`), ilike(sensors.name, `%${a.query}%`), ilike(assets.tag, `%${a.query}%`), ilike(assets.name, `%${a.query}%`)) : undefined))
    .orderBy(asc(sites.name), asc(sensors.tag)).limit(12);
  const open = rows.length ? await tx.select({ sensorId: alarmEvents.sensorId, severity: alarmEvents.severity }).from(alarmEvents)
    .where(and(inArray(alarmEvents.sensorId, rows.map((r) => r.s.id)), notInArray(alarmEvents.state, ['resolved', 'closed']))) : [];
  return rows.map((r) => {
    const def = MEASURAND_DEFS[r.s.measurand];
    const fr = freshness(r.s.lastTs, r.s.expectedIntervalS);
    const alarm = open.find((o) => o.sensorId === r.s.id);
    const v = r.s.lastValue;
    const status = alarm ? `in ${alarm.severity} alarm` : v === null ? 'no data' : def.typicalRange && (v < def.typicalRange[0] || v > def.typicalRange[1]) ? 'outside the typical range' : 'within the typical range';
    return {
      tag: r.s.tag, name: r.s.name, measurand: r.s.measurand, label: def.label, value: v, unit: r.s.unit, at: r.s.lastTs?.toISOString() ?? null,
      ago: ago(r.s.lastTs), freshness: fr, status, asset: r.assetTag ? (r.assetName && !r.assetName.includes(r.assetTag) ? `${r.assetTag} ${r.assetName}` : r.assetName ?? r.assetTag) : null, site: r.siteName, synthetic: r.s.lastSource === 'simulator',
    };
  });
}

async function openAlarms(tx: Tx, p: Principal) {
  const rows = await tx.select({ a: alarmEvents, assetTag: assets.tag }).from(alarmEvents).leftJoin(assets, eq(assets.id, alarmEvents.assetId))
    .where(and(siteScope(p, alarmEvents.siteId), notInArray(alarmEvents.state, ['resolved', 'closed'])))
    .orderBy(sql`case ${alarmEvents.severity} when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end`, desc(alarmEvents.triggeredAt)).limit(10);
  return rows.map((r) => ({ title: r.a.title, severity: r.a.severity, state: r.a.state, asset: r.assetTag, since: ago(r.a.triggeredAt), value: r.a.triggerValue, unit: r.a.unit }));
}

async function myWork(tx: Tx, p: Principal) {
  const insp = await tx.select({ title: inspections.title, status: inspections.status, dueAt: inspections.dueAt }).from(inspections)
    .where(and(eq(inspections.assignedTo, p.userId), inArray(inspections.status, ['scheduled', 'in_progress', 'paused']))).orderBy(asc(inspections.dueAt)).limit(8);
  const tasks = await tx.select({ title: maintenanceTasks.title, status: maintenanceTasks.status, priority: maintenanceTasks.priority, dueAt: maintenanceTasks.dueAt }).from(maintenanceTasks)
    .where(and(eq(maintenanceTasks.assignedTo, p.userId), inArray(maintenanceTasks.status, ['open', 'assigned', 'in_progress', 'on_hold']))).orderBy(asc(maintenanceTasks.dueAt)).limit(8);
  const now = Date.now();
  return {
    inspections: insp.map((i) => ({ title: i.title, status: i.status, overdue: !!i.dueAt && i.dueAt.getTime() < now })),
    tasks: tasks.map((t) => ({ title: t.title, status: t.status, priority: t.priority, overdue: !!t.dueAt && t.dueAt.getTime() < now })),
  };
}

async function assetStatus(tx: Tx, p: Principal, tag: string) {
  const [a] = await tx.select().from(assets).where(and(siteScope(p, assets.siteId), isNull(assets.archivedAt), or(ilike(assets.tag, tag), ilike(assets.tag, tag.replace(/\s+/g, '-')), ilike(assets.name, `%${tag}%`)))).limit(1);
  if (!a) return null;
  const r = await readings(tx, p, { query: a.tag });
  return { tag: a.tag, name: a.name, status: a.status, readings: r.filter((x) => x.asset?.startsWith(a.tag)) };
}

async function procedures(tx: Tx, p: Principal, q: string) {
  return tx.select({ title: documents.title, passage: sql<string>`ts_headline('english', ${documents.body}, websearch_to_tsquery('english', ${q}), 'MaxWords=30, MinWords=12, StartSel=, StopSel=')` })
    .from(documents).where(and(eq(documents.status, 'approved'), or(isNull(documents.siteId), siteScope(p, documents.siteId) ?? sql`true`),
      sql`to_tsvector('english', ${documents.title} || ' ' || ${documents.body}) @@ websearch_to_tsquery('english', ${q})`)).limit(2);
}

// ------------------------------------------------------------------ deterministic engine
export async function answerWithRules(tx: Tx, p: Principal, text: string): Promise<{ answer: string; facts: Fact[]; intent: string }> {
  const t = normalizeUtterance(text);
  const m = detectMeasurand(text);
  const tag = /\b([a-z]{1,3})[\s-]?(\d{2,4})\b/i.exec(t);

  if (/\b(alarm|alarms|alert|alerts|warning|warnings)\b/.test(t)) {
    const al = await openAlarms(tx, p);
    if (!al.length) return { intent: 'alarms', answer: 'There are no open alarms on your sites.', facts: [] };
    const crit = al.filter((a) => a.severity === 'critical').length;
    const top = al[0]!;
    return {
      intent: 'alarms',
      answer: `${al.length} open alarm${al.length === 1 ? '' : 's'}${crit ? `, ${crit} critical` : ''}. Most urgent: ${top.title}${top.asset ? ` on ${top.asset}` : ''}, ${top.state}, raised ${top.since}.`,
      facts: al.slice(0, 5).map((a) => ({ label: `${a.severity} · ${a.title}`, value: a.state, ref: a.asset ?? undefined })),
    };
  }
  if (/\b(task|tasks|job|jobs|inspection|inspections|my work|to do|todo|assigned|what should i do|next)\b/.test(t)) {
    const w = await myWork(tx, p);
    const n = w.inspections.length + w.tasks.length;
    if (!n) return { intent: 'my_work', answer: 'You have no open inspections or maintenance tasks.', facts: [] };
    const overdue = [...w.inspections, ...w.tasks].filter((x) => x.overdue).length;
    const next = w.inspections[0]?.title ?? w.tasks[0]?.title;
    return {
      intent: 'my_work',
      answer: `You have ${w.inspections.length} inspection${w.inspections.length === 1 ? '' : 's'} and ${w.tasks.length} maintenance task${w.tasks.length === 1 ? '' : 's'}${overdue ? `, ${overdue} overdue` : ''}. Next up: ${next}.`,
      facts: [...w.inspections.map((i) => ({ label: `Inspection${i.overdue ? ' · overdue' : ''}`, value: i.title })), ...w.tasks.map((x) => ({ label: `Task · ${x.priority}${x.overdue ? ' · overdue' : ''}`, value: x.title }))],
    };
  }
  if (m) {
    const r = (await readings(tx, p, { measurand: m })).filter((x) => x.value !== null);
    const label = MEASURAND_DEFS[m].label;
    if (!r.length) return { intent: 'reading', answer: `I can't find a live ${label} reading on your sites.`, facts: [] };
    const fresh = r.filter((x) => x.freshness === 'live' || x.freshness === 'delayed');
    const use = (fresh.length ? fresh : r).slice(0, 3);
    const first = use[0]!;
    const one = (x: (typeof r)[number]) => `${x.asset ?? x.name} ${fmt(x.value!, m)}${spokenUnit(x.unit)}`;
    const stale = !fresh.length ? ' These readings are not current - check the sensor.' : '';
    const answer = use.length === 1
      ? `Current ${label} at ${first.asset ?? first.name} is ${fmt(first.value!, m)}${spokenUnit(first.unit)}, measured ${first.ago === 'just now' ? 'just now' : first.ago}, ${first.status}.${stale}`
      : `Current ${label}: ${use.map(one).join('; ')}. Latest reading ${first.ago}; ${use.every((x) => x.status === 'within the typical range') ? 'all within the typical range' : use.filter((x) => x.status !== 'within the typical range').map((x) => `${x.asset ?? x.name} ${x.status}`).join(', ')}.${stale}`;
    return { intent: 'reading', answer, facts: use.map((x) => ({ label: `${x.label} · ${x.asset ?? x.name}`, value: fmt(x.value!, m), unit: x.unit, at: x.at, source: x.synthetic ? 'synthetic demo data' : 'sensor', ref: x.tag })) };
  }
  if (tag) {
    const a = await assetStatus(tx, p, `${tag[1]}-${tag[2]}`);
    if (a) {
      const parts = a.readings.filter((x) => x.value !== null).slice(0, 3).map((x) => `${x.label} ${fmt(x.value!, x.measurand)}${spokenUnit(x.unit)}`);
      return {
        intent: 'asset',
        answer: `${a.tag}, ${a.name}, is ${a.status.replace('_', ' ')}.${parts.length ? ` Readings: ${parts.join(', ')}.` : ''}`,
        facts: a.readings.map((x) => ({ label: `${x.label} · ${x.tag}`, value: x.value === null ? '—' : fmt(x.value, x.measurand), unit: x.unit, at: x.at, ref: x.tag })),
      };
    }
  }
  if (/\b(how (do|to)|procedure|sop|steps|what is the process)\b/.test(t)) {
    const d = await procedures(tx, p, t.trim());
    if (d.length) return { intent: 'procedure', answer: `From the approved procedure "${d[0]!.title}": ${d[0]!.passage.replace(/\s+/g, ' ').trim()}`, facts: d.map((x) => ({ label: 'Procedure', value: x.title })) };
  }
  if (/\b(help|what can you do)\b/.test(t)) {
    return { intent: 'help', answer: 'Ask me for a live reading like "what is the current pH", your open alarms, your tasks for today, or the status of an asset such as "status of P 101".', facts: [] };
  }
  return { intent: 'unknown', answer: "I can't answer that from your plant data. Try asking for a reading, alarms, your tasks, or an asset's status.", facts: [] };
}

// ------------------------------------------------------------------ Claude engine (tool use)
const TOOLS: Anthropic.Tool[] = [
  { name: 'get_readings', description: 'Latest sensor readings on the caller\'s sites. Filter by measurand and/or a free-text query (sensor tag, asset tag or name). Returns value, unit, how long ago, freshness and whether it is within range or in alarm.', strict: true,
    input_schema: { type: 'object', additionalProperties: false, required: ['measurand', 'query'], properties: { measurand: { type: ['string', 'null'], enum: [...MEASURANDS, null] }, query: { type: ['string', 'null'] } } } },
  { name: 'get_open_alarms', description: 'Open (not resolved/closed) alarms on the caller\'s sites, most severe first.', strict: true, input_schema: { type: 'object', additionalProperties: false, required: [], properties: {} } },
  { name: 'get_my_work', description: 'Inspections and maintenance tasks currently assigned to the caller, with overdue flags.', strict: true, input_schema: { type: 'object', additionalProperties: false, required: [], properties: {} } },
  { name: 'get_asset', description: 'Status and readings of one asset by tag (e.g. "P-101") or name.', strict: true, input_schema: { type: 'object', additionalProperties: false, required: ['tag'], properties: { tag: { type: 'string' } } } },
  { name: 'search_procedures', description: 'Search approved SOPs/procedures; returns titles and short passages.', strict: true, input_schema: { type: 'object', additionalProperties: false, required: ['query'], properties: { query: { type: 'string' } } } },
];

const SYSTEM = `You are Hydris, the voice assistant in a wastewater operator's smart glasses. Your reply is spoken aloud.
Answer in one or two short sentences. Use only values returned by the tools in this conversation - never estimate, round away precision, or invent readings, units or times. Say how old a reading is when you give one, and say plainly if it is stale, missing, outside range or in alarm.
If the tools cannot answer, say so. You never operate equipment; for safety-critical actions point to the approved procedure and the supervisor.`;

async function runTool(tx: Tx, p: Principal, name: string, input: Record<string, unknown>) {
  switch (name) {
    case 'get_readings': return readings(tx, p, { measurand: (input.measurand as Measurand | null) ?? null, query: (input.query as string | null) ?? null });
    case 'get_open_alarms': return openAlarms(tx, p);
    case 'get_my_work': return myWork(tx, p);
    case 'get_asset': return (await assetStatus(tx, p, String(input.tag ?? ''))) ?? { error: 'No such asset on your sites' };
    case 'search_procedures': return procedures(tx, p, String(input.query ?? ''));
    default: return { error: `Unknown tool ${name}` };
  }
}

async function answerWithClaude(tx: Tx, p: Principal, text: string, history: { role: 'user' | 'assistant'; text: string }[]) {
  const client = new Anthropic();
  const messages: Anthropic.MessageParam[] = [...history.map((h) => ({ role: h.role, content: h.text })), { role: 'user', content: normalizeUtterance(text).trim() || text }];
  const facts: Fact[] = [];
  for (let turn = 0; turn < 5; turn++) {
    const res = await client.messages.create({ model: ASSISTANT_MODEL, max_tokens: 2000, system: SYSTEM, tools: TOOLS, output_config: { effort: 'low' }, messages });
    if (res.stop_reason === 'refusal') throw new Error('declined');
    messages.push({ role: 'assistant', content: res.content });
    const uses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    if (res.stop_reason !== 'tool_use' || !uses.length) {
      const answer = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join(' ').trim();
      if (!answer) throw new Error('empty answer');
      return { answer, facts, intent: 'llm' };
    }
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const u of uses) {
      try {
        const out = await runTool(tx, p, u.name, u.input as Record<string, unknown>);
        if (u.name === 'get_readings' && Array.isArray(out)) {
          for (const r of out as Awaited<ReturnType<typeof readings>>) if (r.value !== null) facts.push({ label: `${r.label} · ${r.asset ?? r.name}`, value: String(r.value), unit: r.unit, at: r.at, ref: r.tag, source: r.synthetic ? 'synthetic demo data' : 'sensor' });
        }
        results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out) });
      } catch (e) {
        results.push({ type: 'tool_result', tool_use_id: u.id, content: `Error: ${(e as Error).message}`, is_error: true });
      }
    }
    messages.push({ role: 'user', content: results });
  }
  throw new Error('too many steps');
}

// ------------------------------------------------------------------ route
export async function voiceAssistantRoutes(app: FastifyInstance, ctx: Ctx) {
  const auth = { preHandler: authenticate(ctx) };
  app.post('/assistant/ask', { ...auth, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req) => {
    const body = z.object({
      text: z.string().trim().min(1).max(500),
      history: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(1000) })).max(8).optional(),
    }).parse(req.body);
    return tenant(ctx, req, async (tx, p) => {
      if (visionAvailable()) {
        try {
          return { ...(await answerWithClaude(tx, p, body.text, body.history ?? [])), engine: ASSISTANT_MODEL };
        } catch (e) {
          req.log.warn({ err: (e as Error).message }, 'assistant: falling back to rules');
        }
      }
      return { ...(await answerWithRules(tx, p, body.text)), engine: 'hydris-rules' };
    });
  });
}
