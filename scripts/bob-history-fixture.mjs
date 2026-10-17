/** Apply the real PostgREST transcript window in connected browser fixtures. */
export function bobHistoryRows(rows, url) {
  let result = [...rows]
  const role = url.searchParams.get('role')
  if (role?.startsWith('eq.')) result = result.filter(row => row.role === role.slice(3))
  const seq = url.searchParams.get('seq')
  if (seq?.startsWith('lt.')) result = result.filter(row => row.seq < Number(seq.slice(3)))
  result.sort((a, b) => url.searchParams.get('order') === 'seq.desc' ? b.seq - a.seq : a.seq - b.seq)
  const limit = Number(url.searchParams.get('limit'))
  return limit > 0 ? result.slice(0, limit) : result
}
