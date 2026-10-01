/**
 * Which drawn vehicle a mode looks like.
 *
 * The first five modes are their own drawings. A mode added later by the
 * software administrator (te_0007) has none, and names one of the five to
 * be drawn as — a metro as the train, a company car as the car — or none,
 * and is then drawn plain.
 *
 * Kept here, outside any component, because a mode is drawn in a dozen
 * places that are handed nothing but its code. The list of modes says which
 * drawing each borrows once, when it is read; everything that draws a mode
 * asks here.
 */
const borrowed = new Map<string, string>()

/** Called with the modes as they are read from the database. */
export function setModeArt(modes: Array<{ mode: string; art?: string | null }>) {
  for (const m of modes) {
    if (m.art) borrowed.set(m.mode, m.art)
    else borrowed.delete(m.mode)
  }
}

/** The drawing a mode uses: the one it borrows, or its own code. */
export const artOf = (mode: string | null | undefined): string => (mode ? borrowed.get(mode) ?? mode : '')
