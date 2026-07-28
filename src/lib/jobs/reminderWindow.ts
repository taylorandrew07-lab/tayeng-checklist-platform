// When a "report due" reminder is allowed to reach Andrew.
//
// The rule: a reminder that comes due DURING working hours fires immediately —
// he wants to know as soon as the report is genuinely writable. One that comes
// due outside them waits for the next 08:00 that opens a working day, so he is
// never pinged in an evening, on a weekend, or late on a Friday when there is no
// working day left to act in.
//
// Trinidad is America/Port_of_Spain: UTC-4, FIXED, no DST ever. That makes the
// arithmetic a constant offset — but Vercel and GitHub Actions both run in UTC,
// so nothing here may read the host's local timezone. We shift the instant by the
// offset and then read it with getUTC* accessors, which makes those accessors
// report Trinidad wall-clock time on any host.

/** America/Port_of_Spain, UTC-4 fixed. No DST — Trinidad has never observed it. */
const TZ_OFFSET_MS = 4 * 60 * 60 * 1000

const OPEN_HOUR = 8

/** Closing hour by day-of-week (0=Sun). Absent = closed all day. */
const CLOSE_HOUR: Record<number, number> = { 1: 16, 2: 16, 3: 16, 4: 16, 5: 14 }

/** Human copy for the UI, so the hours are stated in exactly one place. */
export const REMINDER_WINDOW_LABEL = 'Mon–Thu 8am–4pm, Fri 8am–2pm (Trinidad time)'

/**
 * Map a raw due instant to the moment the reminder may actually be delivered.
 *
 *  - inside an open window        → unchanged (fire now)
 *  - before 08:00 on an open day  → that day at 08:00
 *  - after close, or a weekend    → the next open day at 08:00
 *
 * Open is inclusive, close is exclusive: exactly 08:00 fires, exactly 16:00
 * (or Friday 14:00) does not.
 */
export function nextOpenWindow(due: Date): Date {
  // Shift into "Trinidad-as-UTC" space so getUTC* reads as local wall clock.
  const t = new Date(due.getTime() - TZ_OFFSET_MS)

  // At most 3 advances are ever needed (Fri evening → Mon). 8 is a safety net so
  // a future rule change can never spin this into an infinite loop.
  for (let i = 0; i < 8; i++) {
    const close = CLOSE_HOUR[t.getUTCDay()]
    if (close !== undefined) {
      const hour = t.getUTCHours() + t.getUTCMinutes() / 60 + t.getUTCSeconds() / 3600
      if (hour >= OPEN_HOUR && hour < close) return new Date(t.getTime() + TZ_OFFSET_MS)
      if (hour < OPEN_HOUR) {
        t.setUTCHours(OPEN_HOUR, 0, 0, 0)
        return new Date(t.getTime() + TZ_OFFSET_MS)
      }
    }
    // Weekend, or past today's close → try the next day from its opening bell.
    t.setUTCDate(t.getUTCDate() + 1)
    t.setUTCHours(OPEN_HOUR, 0, 0, 0)
  }
  return new Date(t.getTime() + TZ_OFFSET_MS)
}

/**
 * Is this job's reminder ready to be shown/sent right now? `dueAt` is the RAW
 * jobs.reminder_due_at (the window is deliberately not baked into the stored
 * value, so changing the delay just moves due_at and the rule stays in one place).
 */
export function isReminderDue(dueAt: string | Date | null | undefined, now: Date = new Date()): boolean {
  if (!dueAt) return false
  const due = dueAt instanceof Date ? dueAt : new Date(dueAt)
  if (Number.isNaN(due.getTime())) return false
  return nextOpenWindow(due).getTime() <= now.getTime()
}
