import { readFile, writeFile } from 'node:fs/promises'
import { VOCABULARY_VERSION, vocabularyTable } from '../src/domain/vocabulary.ts'
const file = new URL('../Docs/domain-dictionary.md', import.meta.url)
const start = '<!-- shared-vocabulary:start -->'
const end = '<!-- shared-vocabulary:end -->'
const content = await readFile(file, 'utf8')
const block = `${start}\n\nVersion: \`${VOCABULARY_VERSION}\`. Generated from [vocabulary.ts](../src/domain/vocabulary.ts); edit that source and run \`npm run sync:vocabulary\`.\n\n${vocabularyTable()}\n\n${end}`
if (!content.includes(start) || !content.includes(end)) throw new Error('Dictionary generation markers are missing')
const updated = content.slice(0, content.indexOf(start)) + block + content.slice(content.indexOf(end) + end.length)
if (process.argv.includes('--check')) {
  if (updated !== content) throw new Error('Shared vocabulary differs from the dictionary; run npm run sync:vocabulary')
} else await writeFile(file, updated)
