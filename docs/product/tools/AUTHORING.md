# Authoring guide: Hydris product documents

The Markdown files in `docs/product/` are the source of truth. `tools/build.js` turns each one into a branded
Word document in `docs/product/word/` (cover page, document control, contents, numbered chapters, figures and
captioned tables). GitHub also renders the Markdown and the Mermaid diagrams directly.

## Commands

```bash
cd docs/product/tools
npm install                     # once
node check.js ../PRD.md         # validate one file: front matter, every diagram renders, house style
node build.js ../PRD.md         # build one Word file into docs/product/word/
node build.js                   # build all
powershell -File finalize.ps1   # Windows + Word: fill the contents pages and export PDFs to word/pdf/
node screenshots.js             # refresh web screenshots in images/ from the live site
```

## Front matter (required)

```yaml
---
title: Product Requirements Document
subtitle: One sentence on what this document answers
short: Product requirements          # running header text
docId: HFG-PRD                       # stable ID
version: 2.0
status: Draft for review
owner: Product, Hydris
audience: Product, engineering, design, leadership, pilot customers
order: 01                            # file order in word/
wordName: PRD                        # Word file name: "01 Hydris PRD.docx"
category: Product requirements       # cover eyebrow
date: October 2026
change: Expanded edition with diagrams, data model detail and acceptance criteria
---
```

## Structure

- `# Title` once at the top (the cover shows it; it is not repeated in the body).
- `##` is a chapter: numbered automatically and starts on a new page. **Never type numbers into headings.**
- `###` is a numbered section (1.1), `####` an unnumbered sub-section.
- Text before the first `##` is an introduction that sits on the first content page.

## Elements

| Element | Markdown |
|---|---|
| Captioned table | a line `Table: Caption text` directly above a GFM table |
| Diagram | a fenced `mermaid` block whose first line is `%% caption: Caption text` |
| Screenshot | `![Caption](images/android-home.png)` (phones, shown 300 px wide); web shots add a width: `![Caption](images/web-console-overview.jpg "627")` |
| Callout | `> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]`, `> [!CAUTION]`, `> [!DECISION]`, `> [!RISK]`, `> [!EXAMPLE]` then the text on the next lines |
| KPI tiles | `> [!STATS]` then list items `> - value \| label \| optional note` (up to 4 per row) |
| Task list | `- [x] done` / `- [ ] open` |
| Code / payloads | fenced blocks with a language (`json`, `http`, `bash`, `kotlin`, `ts`, `sql`) |

## Diagrams (Mermaid 11)

Supported and themed: `flowchart`, `sequenceDiagram`, `erDiagram`, `stateDiagram-v2`, `classDiagram`, `gantt`,
`pie`, `xychart-beta`, `quadrantChart`, `timeline`, `mindmap`, `journey`, `sankey-beta`.

- Keep each diagram readable on an A4 page: about 15 nodes at most, short labels, `flowchart TB` for tall
  layouts and `LR` for pipelines. Split big pictures into several diagrams.
- Quote labels that contain punctuation: `A["Audit scan (OCR)"]`. Use `<br/>` for line breaks inside a node.
- Do not use HTML other than `<br/>`, and do not set custom colours: the build applies the Hydris theme.
- Every diagram needs `%% caption:`. `check.js` renders each diagram and reports the exact error if one fails.

## House style

- Hydris voice: concise, direct, specific. **Never use em dashes** (use a colon, comma, parentheses or two sentences).
- Ground every statement about the current product in the code; name the file (`apps/api/src/modules/devices.ts`).
- Mark status honestly: **Built**, **Partial**, **Planned**. Targets are labelled as targets, never as measured results.
- Keep requirement IDs stable (`FR-xxx`, `NFR-xxx`). New IDs take the next free number; never renumber.
- Numbers that come from tests or the live demo say where they come from.
