// A GBIF range is an ISO 8601 interval with a year-first date on each side: 1997-11-07/1997-11-10,
// 2006-10/2006-11, 2009/2010, 2009-12-30T09:15/2009-12-30T10:00. Both sides must start with a 4-digit year,
// so a slash date like 12/03/15 is not read as a range.
const RANGE = /^(\d{4}(?:-[^/]*)?)\/(\d{4}(?:-[^/]*)?)$/
const CALENDAR = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/

// The first instant after a date written at its own precision: 2010 ends on 1 Jan 2011, 2006-11 on 1 Dec 2006,
// 1997-11-10 at the midnight after that day, a date-time 1 ms after it.
function endOf(dateStr, start) {
  const calendar = CALENDAR.exec(dateStr)
  if (!calendar) return new Date(start.getTime() + 1)
  const [year, month, day] = calendar.slice(1).map(Number)
  if (!calendar[2]) return new Date(year + 1, 0, 1)
  if (!calendar[3]) return new Date(year, month, 1)
  return new Date(year, month - 1, day + 1)
}

/**
 * The time a record's date covers, as { start, end } with end exclusive, or null when it does not parse.
 * A single date written to the month (1954-02) or the year (1965) covers that whole month or year; any other
 * single date covers only its own instant (its local midnight for a full calendar date). A GBIF range covers
 * every day from its start to the end of its last day, month or year.
 */
export function dateSpan(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null
  if (looksLikeRange(dateStr)) {
    const range = RANGE.exec(dateStr.trim())
    const start = range && parseSingleDate(range[1])
    const last = range && parseSingleDate(range[2])
    if (!start || !last || last < start) return null
    return { start, end: endOf(range[2], last) }
  }
  const d = parseSingleDate(dateStr)
  if (!d) return null
  const partial = CALENDAR.exec(dateStr)
  return { start: d, end: partial && !partial[3] ? endOf(dateStr, d) : new Date(d.getTime() + 1) }
}

/** True when any part of a record's date falls in [from, toExclusive); a missing bound is open. */
export function dateOverlaps(dateStr, from, toExclusive) {
  const span = dateSpan(dateStr)
  if (!span) return false
  if (from && span.end <= from) return false
  if (toExclusive && span.start >= toExclusive) return false
  return true
}

// Parse date strings in various formats (DD-MMM-YY, YYYY-MM-DD, etc.). A GBIF range is read as its start, so
// sorting, the time slider and the date panel place it there; the filter uses dateSpan to match the whole range.
export function parseDate(dateStr) {
  if (!dateStr) return null
  if (looksLikeRange(dateStr)) return dateSpan(dateStr)?.start ?? null
  return parseSingleDate(dateStr)
}

// Year-first text with a slash is a range or nothing: new Date('1997-11-07/') would still give a date.
function looksLikeRange(dateStr) {
  return typeof dateStr === 'string' && dateStr.includes('/') && /^\s*(?:\d{4}|\/)/.test(dateStr)
}

// A date as written, split at a range's slash so each side can be shown whole: ['1997-11-07', '1997-11-10'].
export function dateDisplayParts(value) {
  const raw = String(value ?? '')
  const range = RANGE.exec(raw.trim())
  return range ? [range[1], range[2]] : [raw]
}

// Sort key for the host plant gallery: the date's first 8 digits (YYYYMMDD, padded); a range sorts by its start.
export function dateSortValue(value) {
  const raw = String(value || '')
  const range = RANGE.exec(raw.trim())
  const digits = (range ? range[1] : raw).replace(/\D+/g, '').slice(0, 8)
  return digits ? Number(digits.padEnd(8, '0')) : 0
}

function parseSingleDate(dateStr) {
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
  const calendar = CALENDAR.exec(dateStr)
  if (calendar) {
    const [year, month, day] = [calendar[1], calendar[2] ?? '1', calendar[3] ?? '1'].map(Number)
    const d = new Date(year, month - 1, day)
    // An impossible date (2022-13-45, 2022-02-30) is not rolled over into another day.
    return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day ? d : null
  }

  const d = new Date(dateStr)
  return isNaN(d.getTime()) ? null : d
}

// Local midnight on 1 January of any year (new Date(23, 0, 1) would be 1923).
export function startOfYear(year) {
  const d = new Date(2000, 0, 1)
  d.setFullYear(year)
  return d
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

