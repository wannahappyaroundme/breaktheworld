const KST_MINUS_BOUNDARY_HOURS = 5

/** Returns the KST play-day key whose boundary is 04:00, without host timezone reads. */
export function kstDayKey(date: Date): string {
  const time = date.getTime()
  if (!Number.isFinite(time)) throw new RangeError('A valid date is required')
  const shifted = new Date(time + KST_MINUS_BOUNDARY_HOURS * 60 * 60 * 1_000)
  return shifted.toISOString().slice(0, 10)
}
