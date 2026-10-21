/**
 * Layout-aware document extraction with Claude vision (optional engine).
 *
 * Runs when ANTHROPIC_API_KEY (or another Anthropic credential) is configured. It reads every
 * page image and returns structured fields (with page + bounding box), tables, figures and the
 * page text as Markdown. Its values are then cross-checked against the on-device OCR readings,
 * so every extracted value carries two independent readings (machine verification).
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

export const VISION_MODEL = 'claude-opus-5-5';
export const VISION_ENGINE = `vision:${VISION_MODEL}`;

const Box = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).describe('Normalized 0..1 box, origin top-left of the page');

const Extraction = z.object({
  title: z.string().describe('Document title as printed, or a short descriptive title'),
  doc_type: z.string().describe('e.g. inspection checklist, lab report, permit, calibration certificate, maintenance log, invoice'),
  summary: z.string().describe('Two sentences: what the document is and its key outcome'),
  pages: z.array(z.object({ page: z.number().int(), markdown: z.string().describe('All text on the page in reading order as Markdown (tables as Markdown tables)') })),
  fields: z.array(z.object({
    label: z.string(),
    value: z.string().describe('Exactly as written on the page (no unit)'),
    unit: z.string().nullable(),
    type: z.enum(['text', 'number', 'date', 'id', 'checkbox', 'signature']),
    page: z.number().int(),
    box: Box.nullable(),
    confidence: z.number().describe('0..1 legibility confidence'),
  })),
  tables: z.array(z.object({ title: z.string().nullable(), page: z.number().int(), box: Box.nullable(), header: z.array(z.string()), rows: z.array(z.array(z.string())) })),
  figures: z.array(z.object({ page: z.number().int(), box: Box, kind: z.enum(['photo', 'diagram', 'chart', 'signature', 'stamp', 'logo', 'other']), caption: z.string() })),
  warnings: z.array(z.string()).describe('Illegible areas, crossed-out values, missing signatures, inconsistencies'),
});
export type VisionExtraction = z.infer<typeof Extraction>;

const SYSTEM = `You digitize paper audit documents from wastewater and industrial plants (inspection checklists, lab reports, permits, calibration certificates, maintenance logs).
Transcribe faithfully: never correct, normalize or infer values that are not legible - put unreadable parts in warnings and give them low confidence.
Every labelled value (including checkboxes, dates, IDs, signatures and handwritten entries) becomes a field. Values inside a table belong to the table, not to fields.
Boxes are normalized to the page image (0..1, origin top-left) and should tightly enclose the value (fields), the whole table, or the figure.
Figures are non-text regions worth keeping: photos, diagrams, charts, logos, stamps, signatures.`;

export function visionAvailable(): boolean {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export async function extractWithVision(pages: { mime: string; data: string }[], hint?: string): Promise<VisionExtraction> {
  const client = new Anthropic();
  const content: Anthropic.ContentBlockParam[] = [];
  pages.forEach((p, i) => {
    content.push({ type: 'text', text: `Page ${i + 1}:` });
    content.push({ type: 'image', source: { type: 'base64', media_type: p.mime as 'image/jpeg' | 'image/png' | 'image/webp', data: p.data } });
  });
  content.push({ type: 'text', text: `Extract this ${pages.length}-page document.${hint ? ` Context from the operator: ${hint}` : ''}` });

  const response = await client.messages.parse({
    model: VISION_MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    output_config: { effort: 'medium', format: zodOutputFormat(Extraction) },
    messages: [{ role: 'user', content }],
  });
  if (response.stop_reason === 'refusal') throw new Error(`Vision extraction declined${response.stop_details?.category ? ` (${response.stop_details.category})` : ''}`);
  if (response.stop_reason === 'max_tokens') throw new Error('Vision extraction output was truncated (document too long)');
  if (!response.parsed_output) throw new Error('Vision extraction returned no structured output');
  return response.parsed_output;
}

export function describeVisionError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return 'Anthropic credential rejected';
  if (e instanceof Anthropic.RateLimitError) return 'Vision engine rate limited - retry shortly';
  if (e instanceof Anthropic.APIError) return `Vision engine error ${e.status ?? ''}`.trim();
  return e instanceof Error ? e.message.slice(0, 200) : 'Vision extraction failed';
}
