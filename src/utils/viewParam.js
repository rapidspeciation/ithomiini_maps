// The table view goes into the page address (?view=table) so a shared link opens the view it was copied from.
// The map is the default and leaves no parameter.

/** The query string `search` with the view parameter set for `view` ('map' or 'table'), other parameters kept. */
export function searchWithView(search, view) {
  const params = new URLSearchParams(search)
  if (view === 'table') params.set('view', 'table')
  else params.delete('view')
  const query = params.toString()
  return query ? `?${query}` : ''
}
