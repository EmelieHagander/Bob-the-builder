/**
 * Builds the Wood Handbook passage migrations from the original PDF.
 *
 *   node --import tsx scripts/build-knowledge-wood-handbook.ts --pdf <path/to/62200.pdf>
 *   node --import tsx scripts/build-knowledge-wood-handbook.ts --check
 *
 * Source: Forest Products Laboratory. 2021. Wood handbook—wood as an
 * engineering material. FPL-GTR-282. A work of the U.S. federal government
 * (17 U.S.C. §105), so its text may be stored, embedded and quoted. The PDF
 * (104 MB) is not committed; --check verifies the committed migrations are
 * intact against the hash recorded in them. Needs `pdftotext` (poppler).
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'

export const SOURCE = {
  id: 'usda.wood-handbook.2021',
  title: 'Wood Handbook: Wood as an Engineering Material',
  publisher: 'USDA Forest Service, Forest Products Laboratory',
  edition: 'General Technical Report FPL-GTR-282 (2021)',
  url: 'https://research.fs.usda.gov/treesearch/62200',
  document_url: 'https://research.fs.usda.gov/download/treesearch/62200.pdf',
  rights: 'us_federal_public_domain',
  jurisdiction: 'general',
  language: 'en',
  extraction: 'pdftotext (poppler), running headers, page numbers, chapter contents lists and the index removed; paragraphs joined.',
  limitations: 'United States reference: grades, species, design values and units (inch, psi) are American, not Swedish/Eurocode. Equations and tables can be garbled by text extraction; open the original page before using a number. General engineering knowledge, not a structural approval of a project.',
  reviewed_at: '2026-11-16',
} as const
const PART_BYTES = 700_000
const MAX_PASSAGE = 1800
const MIGRATION = (n: number) => `20261116100${n}00_knowledge_corpus_wood_handbook_part${n}.sql`
const TAG = '$wh$'

export interface Passage { id: string; ordinal: number; chapter: number | null; chapter_title: string | null; page_label: string | null; pdf_page: number; text: string }

const RUNNING = /^(General Technical Report FPL[–-]GTR[–-]282|CHAPTER \d+ \| .*)$/
const PAGE_LABEL = /^(\d{1,2}|I)[–-]\d{1,3}$/
/** A line that is only figure axis numbers, units or stray symbols. */
const NOISE = (line: string) => line.length <= 1 || /^[\d\s.,%()–\-+×x/=°]+$/.test(line)

export function passagesFromPages(pages: string[]): Passage[] {
  const out: Passage[] = []
  let chapter: number | null = null, chapterTitle: string | null = null
  let buffer = '', bufferPage = 0, bufferLabel: string | null = null
  const flush = () => {
    const text = buffer.replace(/\s+/g, ' ').trim()
    if (text.length >= 200) {
      const ordinal = out.length + 1
      out.push({ id: `wh2021:${String(chapter ?? 0).padStart(2, '0')}:${String(ordinal).padStart(4, '0')}`, ordinal, chapter, chapter_title: chapterTitle,
        page_label: bufferLabel, pdf_page: bufferPage, text })
    }
    buffer = ''
  }
  for (let index = 0; index < pages.length; index++) {
    const lines = pages[index].split('\n').map(line => line.trim())
    const first = lines.find(Boolean) ?? ''
    if (first === 'INDEX') { flush(); break }
    const start = first.match(/^CHAPTER (\d+)$/)
    if (start) {
      flush()
      chapter = Number(start[1])
      const titleLines: string[] = []
      // The title runs until the first author line ("Name, Role") or blank line.
      for (const line of lines.slice(lines.indexOf(first) + 1)) { if (!line) { if (titleLines.length) break; continue } if (/, [A-Z][a-z]+ ?(Research|Forest|General|Engineer|Scientist|Botanist|Chemist|Leader|Associate|Technologist|Entomologist)|, (Research|Supervisory|Postdoctoral|Project|Materials)\b/.test(line)) break; titleLines.push(line) }
      chapterTitle = titleLines.join(' ').replace(/\s+/g, ' ').slice(0, 200)
    }
    if (chapter === null) continue // front matter
    const label = lines.filter(line => PAGE_LABEL.test(line)).at(-1) ?? null
    let inContents = false
    const paragraphs: string[] = []
    let current: string[] = []
    for (const line of lines) {
      if (line === 'Contents') { inContents = true; continue }
      if (inContents) { if (!line || /\d+[–-]\d+$/.test(line) || line.length < 60) continue; inContents = false }
      if (!line) { if (current.length) paragraphs.push(current.join(' ')); current = []; continue }
      if (RUNNING.test(line) || PAGE_LABEL.test(line) || NOISE(line)) continue
      if (start && chapterTitle && chapterTitle.startsWith(line)) continue
      current.push(line)
    }
    if (current.length) paragraphs.push(current.join(' '))
    for (const paragraph of paragraphs) {
      const clean = paragraph.replace(/(\p{L})- (\p{Ll})/gu, '$1$2').replace(/\s+/g, ' ').trim()
      if (!clean) continue
      if (buffer && buffer.length + clean.length + 1 > MAX_PASSAGE) flush()
      if (!buffer) { bufferPage = index + 1; bufferLabel = label }
      // A single paragraph longer than a passage is split at sentence ends.
      if (clean.length > MAX_PASSAGE) {
        for (const sentence of clean.split(/(?<=[.!?])\s+/).map(part => part + ' ')) {
          if (buffer && buffer.length + sentence.length > MAX_PASSAGE) { flush(); bufferPage = index + 1; bufferLabel = label }
          buffer += sentence.slice(0, MAX_PASSAGE)
        }
      } else buffer += (buffer ? '\n' : '') + clean
    }
  }
  flush()
  return out
}

const quote = (value: string | number | null) => value === null ? 'null' : typeof value === 'number' ? String(value) : TAG + value + TAG

export function migrations(passages: Passage[], documentSha256: string): Map<string, string> {
  const files = new Map<string, string>()
  const parts: Passage[][] = [[]]
  let bytes = 0
  for (const passage of passages) {
    if (bytes > PART_BYTES) { parts.push([]); bytes = 0 }
    parts.at(-1)!.push(passage); bytes += Buffer.byteLength(passage.text) + 120
  }
  const corpusHash = createHash('sha256').update(JSON.stringify(passages)).digest('hex')
  parts.forEach((part, i) => {
    const n = i + 1
    const lines = [
      `-- Generated by scripts/build-knowledge-wood-handbook.ts. Do not edit by hand.`,
      `-- ${SOURCE.title}, ${SOURCE.edition}. U.S. federal work (17 U.S.C. §105).`,
      `-- Part ${n} of ${parts.length}; passages ${part[0].ordinal}-${part.at(-1)!.ordinal} of ${passages.length}.`,
      `-- document_sha256 ${documentSha256} corpus_sha256 ${corpusHash}`,
      'begin;',
      "set local statement_timeout = '120s';",
    ]
    if (n === 1) lines.push(`insert into bob_private.knowledge_sources(id,title,publisher,edition,url,document_url,rights,jurisdiction,language,document_sha256,extraction,limitations,reviewed_at) values(${
      [SOURCE.id, SOURCE.title, SOURCE.publisher, SOURCE.edition, SOURCE.url, SOURCE.document_url, SOURCE.rights, SOURCE.jurisdiction, SOURCE.language, documentSha256, SOURCE.extraction, SOURCE.limitations].map(v => quote(v)).join(',')},date '${SOURCE.reviewed_at}');`)
    lines.push('insert into bob_private.knowledge_passages(id,source_id,ordinal,chapter,chapter_title,page_label,pdf_page,text) values')
    lines.push(part.map(p => `(${[p.id, SOURCE.id, p.ordinal, p.chapter, p.chapter_title, p.page_label, p.pdf_page, p.text].map(quote).join(',')})`).join(',\n') + ';')
    lines.push('commit;', '')
    files.set(MIGRATION(n), lines.join('\n'))
  })
  return files
}

/** Reads the passages back out of committed migrations (for tests and --check). */
export function passagesFromMigrations(sql: string[]): Passage[] {
  const out: Passage[] = []
  const row = /\(\$wh\$([^$]*)\$wh\$,\$wh\$[^$]*\$wh\$,(\d+),(\d+|null),(\$wh\$[\s\S]*?\$wh\$|null),(\$wh\$[^$]*\$wh\$|null),(\d+),\$wh\$([\s\S]*?)\$wh\$\)/g
  const unq = (v: string) => v === 'null' ? null : v.slice(4, -4)
  for (const text of sql) for (const m of text.matchAll(row))
    out.push({ id: m[1], ordinal: Number(m[2]), chapter: m[3] === 'null' ? null : Number(m[3]), chapter_title: unq(m[4]), page_label: unq(m[5]), pdf_page: Number(m[6]), text: m[7] })
  return out
}

export function committedCorpus(root = new URL('../supabase/migrations/', import.meta.url)) {
  const names = readdirSync(root).filter(name => /_knowledge_corpus_wood_handbook_part\d+\.sql$/.test(name)).sort()
  const sql = names.map(name => readFileSync(new URL(name, root), 'utf8'))
  return { names, sql, passages: passagesFromMigrations(sql) }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  if (args[0] === '--check') {
    const { names, sql, passages } = committedCorpus()
    const header = sql.map(text => text.match(/document_sha256 ([a-f0-9]{64}) corpus_sha256 ([a-f0-9]{64})/))
    if (!names.length || header.some(h => !h)) throw new Error('knowledge corpus migrations missing or without hash header')
    const corpusHash = createHash('sha256').update(JSON.stringify(passages)).digest('hex')
    if (header.some(h => h![2] !== corpusHash)) throw new Error('knowledge corpus migrations were edited by hand or are incomplete')
    const regenerated = migrations(passages, header[0]![1])
    if ([...regenerated.keys()].join() !== names.join() || names.some((name, i) => regenerated.get(name) !== sql[i])) throw new Error('knowledge corpus migrations are not reproducible')
    console.log(`ok: ${passages.length} passages in ${names.length} migrations`)
  } else if (args[0] === '--pdf' && args[1]) {
    const pdf = readFileSync(args[1])
    const documentSha256 = createHash('sha256').update(pdf).digest('hex')
    const text = execFileSync('pdftotext', [args[1], '-'], { maxBuffer: 64 * 1024 * 1024, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    const passages = passagesFromPages(text.split('\f'))
    if (passages.some(p => p.text.includes(TAG))) throw new Error('passage contains the quoting tag')
    for (const [name, content] of migrations(passages, documentSha256)) writeFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), content)
    console.log(`wrote ${passages.length} passages`)
  } else {
    console.error('usage: --pdf <file> | --check'); process.exit(2)
  }
}
