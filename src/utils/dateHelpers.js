// Parse date strings in various formats (DD-MMM-YY, YYYY-MM-DD, etc.)
export function parseDate(dateStr) {
  if (!dateStr) return null

  const ddMmmYy = /^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/
  const match = dateStr.match(ddMmmYy)
  if (match) {
    const [, day, monthStr, yearShort] = match
    const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }
    const month = months[monthStr.toLowerCase()]
    if (month !== undefined) {
      const year = parseInt(yearShort) + (parseInt(yearShort) > 50 ? 1900 : 2000)
      return new Date(year, month, parseInt(day))
    }
  }

  // A calendar date without a time (YYYY, YYYY-MM, YYYY-MM-DD; GBIF and the date inputs) is that local
  // day, like the DD-Mon-YY dates above. new Date('2022-01-18') would be UTC midnight, the day before in the Americas.
  const calendar = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(dateStr)
  if (calendar) {
    const [year, month, day] = [calendar[1], calendar[2] ?? '1', calendar[3] ?? '1'].map(Number)
    const d = new Date(year, month - 1, day)
    // An impossible date (2022-13-45, 2022-02-30) is not rolled over into another day.
    return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day ? d : null
  }

  const d = new Date(dateStr)
  return isNaN(d.getTime()) ? null : d
}

// A date's local calendar day as YYYY-MM-DD (toISOString would give the UTC day, a day off east or west of UTC).
export function toLocalISODate(date) {
  const pad = n => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

// Get date offset from today (negative for past)
export function getDateOffset(days) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return toLocalISODate(date)
}

