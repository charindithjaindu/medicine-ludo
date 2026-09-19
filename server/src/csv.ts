/**
 * A small RFC-4180 CSV reader/writer. Small enough not to warrant a dependency, but
 * it does handle the cases that actually bite: quoted fields containing commas,
 * escaped quotes, and CRLF line endings — all of which Excel emits.
 */

export function parseCsv(input: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0

  while (i < input.length) {
    const ch = input[i]

    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += ch
      i++
      continue
    }

    if (ch === '"') {
      inQuotes = true
      i++
      continue
    }
    if (ch === ',') {
      row.push(field)
      field = ''
      i++
      continue
    }
    if (ch === '\r') {
      i++
      continue
    }
    if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i++
      continue
    }
    field += ch
    i++
  }

  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

/** Parse into objects keyed by the header row, with headers normalised to snake_case. */
export function parseCsvObjects(input: string): Array<Record<string, string>> {
  const rows = parseCsv(input)
  if (rows.length === 0) return []
  const headers = rows[0].map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, '_'))
  return rows.slice(1).map((r) => {
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => {
      obj[h] = (r[i] ?? '').trim()
    })
    return obj
  })
}

function escapeCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(headers: string[], rows: Array<Record<string, unknown>>): string {
  const lines = [headers.join(',')]
  for (const row of rows) lines.push(headers.map((h) => escapeCell(row[h])).join(','))
  return lines.join('\n') + '\n'
}
