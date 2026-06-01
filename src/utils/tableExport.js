/**
 * Minimal CSV builder + browser download helper for table exports.
 */

function csvEscape(val) {
  const s = val == null ? '' : String(val)
  // Quote when the value contains a delimiter, quote, or newline.
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

/**
 * Build a CSV string from an array of header descriptors and rows.
 * @param {{label: string, value: (row: any) => any}[]} headers
 * @param {any[]} rows
 */
export function rowsToCsv(headers, rows) {
  const lines = [headers.map(h => csvEscape(h.label)).join(',')]
  for (const row of rows) {
    lines.push(headers.map(h => csvEscape(h.value(row))).join(','))
  }
  return lines.join('\r\n')
}

/** Trigger a client-side download of `csv` as `filename`. */
export function downloadCsv(filename, csv) {
  // Prepend a UTF-8 BOM so Excel reads accented species names correctly.
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
