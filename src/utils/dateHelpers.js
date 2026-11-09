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
    const [, year, month = '1', day = '1'] = calendar
    return new Date(Number(year), Number(month) - 1, Number(day))
  }

  const d = new Date(dateStr)
  return isNaN(d.getTime()) ? null : d
}

// Get date offset from today (negative for past)
export function getDateOffset(days) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date.toISOString().split('T')[0]
}

