/**
 * CLI seed: `npm run import:pdf [path/to/cards.pdf]`
 *
 * Idempotent — re-running it corrects the seeded cards rather than duplicating them.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { EXPECTED_CARDS, importPdf } from '../server/src/pdf-import.js'
import { activeCountByTier } from '../server/src/db.js'
import { TIER_NAMES, TIERS } from '../shared/src/types.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const pdfPath = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : path.resolve(here, '../tiered qa cards.pdf')

console.log(`Importing ${pdfPath}`)
const result = importPdf(pdfPath)

console.log(`  parsed  ${result.parsed}/${EXPECTED_CARDS} cards`)
console.log(`  created ${result.created}`)
console.log(`  updated ${result.updated}`)

const counts = activeCountByTier()
for (const tier of TIERS) {
  console.log(`  tier ${tier} ${TIER_NAMES[tier].padEnd(15)} ${counts[tier]} active`)
}

if (result.problems.length > 0) {
  console.log(`\n${result.problems.length} problem(s) — these cards were NOT imported:`)
  for (const p of result.problems) console.log(`  - ${p}`)
  process.exitCode = 1
} else {
  console.log('\nNo problems.')
}
