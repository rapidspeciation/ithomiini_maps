#!/usr/bin/env node
// Builds public/data/taxonomy_name_corrections.json from a name correction table (TSV).
//
// The table has one row per old name: source_label (the name as recorded), corrected_label
// (the current name), corrected_rank and source (the references that support the change).
// The app applies the corrections when it loads the occurrence data (src/utils/nameCorrections.js),
// so the map, the filters and the search show the current names. The source data files are not changed.
//
// Usage: node scripts/build_taxonomy_name_corrections.js <label_corrections.tsv>
import fs from 'node:fs'
import path from 'node:path'

const projectRoot = path.resolve(import.meta.dirname, '..')
const outputPath = path.join(projectRoot, 'public', 'data', 'taxonomy_name_corrections.json')

const tablePath = process.argv[2]
if (!tablePath) {
  console.error('Usage: node scripts/build_taxonomy_name_corrections.js <label_corrections.tsv>')
  process.exit(1)
}

// Short reference tokens in the table, written out for the page.
const REFERENCE_NAMES = {
  vdh2025: 'van der Heijden et al. 2025',
  'boa 2024': 'Butterflies of America 2024',
  boa2024: 'Butterflies of America 2024',
  'doré 2022': 'Doré et al. 2022',
  'dore 2022': 'Doré et al. 2022',
  'fox 1960': 'Fox 1960',
}

const formatReference = (source = '') => {
  const parts = String(source)
    .split(';')
    .map(part => part.replace(/\([^)]*\)/g, '').trim())
    .filter(Boolean)
    .map(part => {
      const name = REFERENCE_NAMES[part.toLowerCase()]
      if (!name) throw new Error(`Unknown reference "${part}": add it to REFERENCE_NAMES`)
      return name
    })
  return [...new Set(parts)].join('; ')
}

const clean = value => String(value ?? '').trim().replace(/\s+/g, ' ')

const lines = fs.readFileSync(tablePath, 'utf8').split(/\r?\n/).filter(line => line.trim())
const header = lines[0].split('\t')
const column = name => {
  const index = header.indexOf(name)
  if (index < 0) throw new Error(`Column ${name} missing in ${tablePath}`)
  return index
}
const oldColumn = column('source_label')
const currentColumn = column('corrected_label')
const rankColumn = column('corrected_rank')
const sourceColumn = column('source')

const corrections = []
const seen = new Map()
for (const line of lines.slice(1)) {
  const cells = line.split('\t')
  const oldName = clean(cells[oldColumn])
  const currentName = clean(cells[currentColumn])
  if (!oldName || !currentName || oldName === currentName) continue
  const oldParts = oldName.split(' ')
  const currentParts = currentName.split(' ')
  if (oldParts.length < 2 || oldParts.length > 3 || currentParts.length < 2 || currentParts.length > 3) {
    throw new Error(`Expected a species or subspecies name: "${oldName}" -> "${currentName}"`)
  }
  if (seen.has(oldName) && seen.get(oldName) !== currentName) {
    throw new Error(`"${oldName}" maps to both "${seen.get(oldName)}" and "${currentName}"`)
  }
  if (seen.has(oldName)) continue
  seen.set(oldName, currentName)
  corrections.push({
    old_name: oldName,
    current_name: currentName,
    current_rank: /subspecies|form/i.test(cells[rankColumn] || '') ? 'subspecies' : 'species',
    reference: formatReference(cells[sourceColumn]),
  })
}

// No chains: a current name is never also an old name.
for (const entry of corrections) {
  if (seen.has(entry.current_name)) {
    throw new Error(`Chained correction: "${entry.current_name}" is both a current and an old name`)
  }
}

corrections.sort((a, b) => a.current_name.localeCompare(b.current_name) || a.old_name.localeCompare(b.old_name))

fs.writeFileSync(outputPath, `${JSON.stringify({
  metadata: {
    description: 'Old butterfly names in the occurrence data and their current names. The app applies them when it loads the data.',
    taxonomy: 'van der Heijden et al. 2025 where it covers the genus, otherwise Butterflies of America 2024. Named colour forms are kept as subspecies labels.',
    generated_at: new Date().toISOString(),
    correction_count: corrections.length,
  },
  corrections,
}, null, 2)}\n`)

console.log(`Wrote ${corrections.length} name corrections to ${outputPath}`)
