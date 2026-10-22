/*
  Where a ticket goes from and to (the user, 21 Oct: "for flights, train, bus, actually from and to is
  there, so can we auto fetch"). Read off the ticket's own text: a flight by its airport codes and the
  airport names under them, a bus by its From, To, boarding and drop points, a train by its From and To
  stations. What comes back is what to look up on the map, by the ride's mode.
*/
export interface TicketRoute {
  airportFrom?: string; airportTo?: string; cityFrom?: string; cityTo?: string
  from?: string; to?: string; boarding?: string; drop?: string
  /** Where the planes were changed on the way: not a destination (the user, 22 Oct). */
  via?: string[]
  /** Each journey on the ticket — a round trip has two, on their own days. */
  journeys?: Journey[]
}
export interface Journey { cityFrom: string; cityTo: string; date: string | null; via: string[] }

const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
/**
 * The journeys on a MakeMyTrip flight ticket (the user, 22 Oct: a round trip, Kochi to Vijayawada via Bengaluru
 * and back): each "Kochi-Vijayawada" heading with its date line ("Fri, 7 Aug 2026 • 1 stop"), and the layovers
 * under it ("2h 35m layover • Bengaluru (BLR)"). A change of planes is never where the journey ends.
 */
export function journeysIn(text: string): Journey[] {
  const L = text.split('\n').map(l => l.trim()).filter(Boolean)
  const out: Array<Journey & { at: number }> = []
  L.forEach((l, i) => {
    const h = l.match(/^([A-Za-z][A-Za-z .]+?)\s*-\s*([A-Za-z][A-Za-z .]+)$/)
    const d = L[i + 1]?.match(/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\w*,\s*(\d{1,2})\s+([A-Za-z]{3})\w*\s+(\d{4})/)
    if (!h || !d) return
    const m = MON.indexOf(d[2].toLowerCase())
    const date = m < 0 ? null : `${d[3]}-${String(m + 1).padStart(2, '0')}-${d[1].padStart(2, '0')}`
    out.push({ cityFrom: h[1].trim(), cityTo: h[2].trim(), date, via: [], at: i })
  })
  out.forEach((j, n) => {
    const end = out[n + 1]?.at ?? L.length
    for (const l of L.slice(j.at, end)) {
      const v = l.match(/layover\s*•\s*([A-Za-z][A-Za-z .]+?)(?:\s*\(|$)/i)
      if (v && !j.via.includes(v[1].trim())) j.via.push(v[1].trim())
    }
  })
  return out.map(({ at: _at, ...j }) => j)
}

export function routeIn(text: string): TicketRoute | null {
  const L = text.split('\n').map(l => l.trim()).filter(Boolean)
  const out: TicketRoute = {}
  // A flight: "PAT 13:25 hrs" and "16:05 hrs BLR", the city on the line above, the airport below the date.
  const fi = L.findIndex(l => /^[A-Z]{3}\s+\d{1,2}:\d{2}\s*hrs\b/.test(l))
  const ti = L.findIndex(l => /\b\d{1,2}:\d{2}\s*hrs\s+[A-Z]{3}$/.test(l))
  const airport = (i: number) => {
    const j = L.findIndex((l, k) => k > i && k < i + 4 && /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/.test(l))
    if (j < 0) return undefined
    // Up to the terminal, or the fare class printed on the next line ("Corporate Plus CORPORATE Economy").
    const name = [L[j + 1], L[j + 2]].filter(Boolean).join(' ').replace(/\s+/g, ' ').split(/\s+(?:Terminal|Corporate|Economy|Business|Premium|Saver|Flexi)\b/i)[0].trim()
    return /airport/i.test(name) ? name.replace(/(airport)\b.*$/i, (m, a: string) => (m.length > a.length ? m : a)) : undefined
  }
  if (fi > 0) { out.cityFrom = L[fi - 1]; out.airportFrom = airport(fi) }
  if (ti > 0) { out.cityTo = L[ti - 1]; out.airportTo = airport(ti) }
  // With journeys, the first one's end is where the ride ends, not the first landing on the way.
  const journeys = journeysIn(text)
  if (journeys.length) {
    const j = journeys[0]
    out.journeys = journeys; out.via = j.via
    out.cityFrom = j.cityFrom
    if (out.cityTo !== j.cityTo) {
      const at = L.findIndex((l, k) => k > 0 && L[k - 1] === j.cityTo && /\b\d{1,2}:\d{2}\s*hrs\s+[A-Z]{3}$/.test(l))
      out.cityTo = j.cityTo; out.airportTo = at > 0 ? airport(at) : undefined
    }
  }
  // A bus or a train: labelled fields, each up to the next run of spaces.
  const field = (label: string) => {
    // The label with its colon, at the start of a line or after a run of spaces ("From : X   To : Y" on one line).
    const re = new RegExp(`(?:^|\\s{2,})${label}\\s*:\\s*(.+)$`, 'i')
    for (const l of L) { const m = l.match(re); if (m) { const v = m[1].split(/\s{2,}/)[0].replace(/[:,]+$/, '').trim(); if (v && !/^address\b/i.test(v)) return v } }
    return undefined
  }
  out.from = field('From'); out.to = field('To'); out.boarding = field('Boarding Point'); out.drop = field('Drop Point')
  return Object.values(out).some(Boolean) ? out : null
}

/** What to look up on the map for each end, by the ride's mode: the likeliest first, then a plainer one. */
export function ticketQueries(mode: string, r: TicketRoute): { from: string[]; to: string[]; want: 'airport' | 'station' | 'area' } | null {
  const station = (s?: string) => (s ? `${s.replace(/\(([A-Z]{2,5})\)/, '').trim()}${/station/i.test(s) ? '' : ' railway station'}` : undefined)
  const list = (...xs: Array<string | undefined>) => [...new Set(xs.filter((x): x is string => !!x))]
  const near = (a?: string, b?: string) => (a && b && a !== b ? `${a}, ${b}` : a)
  if (mode === 'flight') return { want: 'airport',
    from: list(r.airportFrom, r.cityFrom && `${r.cityFrom} airport`, r.from && `${r.from} airport`),
    to: list(r.airportTo, r.cityTo && `${r.cityTo} airport`, r.to && `${r.to} airport`) }
  if (mode === 'train') return r.from || r.to ? { want: 'station', from: list(station(r.from)), to: list(station(r.to)) } : null
  if (mode === 'bus') return r.from || r.to || r.boarding || r.drop
    ? { want: 'area', from: list(near(r.boarding, r.from), r.from), to: list(near(r.drop, r.to), r.to) } : null
  return null
}

/*
  A hotel voucher's hotel (the user, 21 Oct: "for hotel auto location how? to hotel address?"): its name,
  which fills the night's name, and its address, which finds it on the map so the ride to it is one tap.
  Where the ride to it starts is the engineer's own pick.
*/
export interface HotelStay { name?: string; address?: string }
export function hotelIn(text: string): HotelStay | null {
  const L = text.split('\n').map(l => l.trim()).filter(Boolean)
  const out: HotelStay = {}
  const night = L.findIndex(l => /^\d+\s*-?\s*Nights?\s+Stay$/i.test(l))
  if (night >= 0 && L[night + 1] && !/booking id/i.test(L[night + 1])) out.name = L[night + 1]
  const v = L.findIndex(l => /^Booking Voucher$/i.test(l))
  if (v >= 0) {
    const parts: string[] = []
    for (const l of L.slice(v + 1, v + 6)) { if (/^[\d\s+()-]{7,}$|@|GST|^For\b/i.test(l)) break; parts.push(l) }
    if (parts.length) out.address = parts.join(' ').replace(/\s+/g, ' ').trim()
  }
  return out.name || out.address ? out : null
}
/** What to look up for the hotel: its name, then the end of its address (the area and the city). */
export function hotelQueries(s: HotelStay): string[] {
  const tail = (s.address ?? '').split(',').map(x => x.trim()).filter(x => x && !/^(IN|India|\d{6})$/i.test(x)).slice(-2).join(', ')
  return [s.name, tail].filter((x): x is string => !!x)
}
