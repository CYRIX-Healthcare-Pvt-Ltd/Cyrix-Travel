import { useEffect, useRef, useState } from 'react'
import { useAsk } from '@/components/Ask'
import { MODES, inkVars, km, money, outOfPolicy, policyNote, rideAmount, type Day, type Rule } from '@/lib/claims'

/*
  A day's (or a trip's) route, drawn (the user, 17 Oct: "a graphical representation that show from
  to, in between km and cost"): each stop a dot — home green, a change of mode grey, a hospital red,
  a hotel violet — and each ride the road between them in its mode's colour, with its mode, km and cost.
*/
const MIN_STEP = 110
// The first and last dots sit this far in; their names read inwards from them.
const EDGE = 24
const PIN = { home: '#1D9E75', change: '#888780', hospital: '#E24B4A', hotel: '#7F77DD', place: '#E24B4A' }

export default function RouteStrip({ days, rule, grade }: { days: Day[]; rule: Rule | undefined; grade?: string | null }) {
  const ask = useAsk()
  // As wide as the card (the user, 17 Oct: "why cant it be stretched").
  const box = useRef<HTMLDivElement>(null)
  const [room, setRoom] = useState(0)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setRoom(el.clientWidth))
    ro.observe(el); setRoom(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  const rides = days.flatMap(d => d.rides.map(r => ({ ...r, day: d })))
  if (!rides.length) return <div ref={box} />
  const tickets = days.flatMap(d => d.tickets)
  type Stop = { name: string; kind: keyof typeof PIN; sub?: string }
  const stops: Stop[] = []
  const kindOf = (name: string | null, i: number, last: boolean): Stop['kind'] => {
    const n = (name ?? '').toLowerCase()
    if (/^home\b|\bhome$/.test(n)) return 'home'
    if (/hotel|lodge|stay/.test(n)) return 'hotel'
    if (/hospital|clinic|medical|centre|center|phc|chc|lab/.test(n)) return 'hospital'
    return last || i === 0 ? 'place' : 'change'
  }
  rides.forEach((r, i) => {
    if (i === 0) stops.push({ name: r.from_name ?? 'Start', kind: kindOf(r.from_name, 0, false) })
    else if ((rides[i - 1].to_name ?? '') !== (r.from_name ?? '')) stops.push({ name: r.from_name ?? '', kind: kindOf(r.from_name, 1, false) })
    const t = tickets.find(x => x.place && r.to_name && r.to_name.toLowerCase().includes(x.place.toLowerCase()))
    stops.push({ name: r.to_name ?? 'End', kind: kindOf(r.to_name, i + 1, i === rides.length - 1), sub: t ? `Ticket ${t.ticket_no}` : undefined })
  })
  // Rides drawn between consecutive stops; a gap (a ride starting elsewhere) is left undrawn.
  const segs: Array<{ from: number; ride: typeof rides[number] }> = []
  let at = 0
  rides.forEach((r, i) => {
    if (i > 0 && (rides[i - 1].to_name ?? '') !== (r.from_name ?? '')) at++
    segs.push({ from: at, ride: r }); at++
  })
  // As wide as the card: a phone shows a day of three stops whole, without scrolling (the user, 18 Oct).
  const STEP = Math.max(MIN_STEP, stops.length > 1 ? (room - 2 * EDGE) / (stops.length - 1) : MIN_STEP)
  const w = Math.max(room || 300, (stops.length - 1) * STEP + 2 * EDGE)
  const names = fitNames(stops.map(x => x.name), STEP)
  // Below the line: each name's one or two lines, then its ticket; the total under the tallest of them.
  const below = Math.max(...stops.map((s, i) => names[i].length * 15 + (s.sub ? 15 : 0)))
  const H = 116 + below + 4
  return (
    <div ref={box} className="overflow-x-auto">
      <svg viewBox={`0 0 ${w} ${H}`} width={w} height={H} role="img" className="max-w-none">
        <title>Route</title>
        {segs.map(({ from, ride }) => {
          const m = MODES[ride.mode]
          const x1 = EDGE + from * STEP, x2 = EDGE + (from + 1) * STEP
          return (
            <g key={ride.id}>
              <line x1={x1} y1={84} x2={x2} y2={84} stroke={m.color} strokeWidth={5} strokeLinecap="round" />
              <m.icon x={(x1 + x2) / 2 - 9} y={14} width={18} height={18} className="mode-ink" style={inkVars(m)} strokeWidth={2.2} />
              {outOfPolicy(ride.mode, rule) && (
                // A press says what the mark means — a phone has no hover (the user, 21 Oct).
                <g role="button" aria-label="Why the red mark" className="cursor-pointer" onClick={() => void ask.alert('Needs prior approval', policyNote(m.label, grade))}>
                  <title>{policyNote(m.label, grade)}</title>
                  <circle cx={(x1 + x2) / 2 + 20} cy={15} r={16} fill="transparent" />
                  <circle cx={(x1 + x2) / 2 + 20} cy={15} r={8} fill="#E30613" stroke="rgb(var(--surface))" strokeWidth={2} />
                  <text x={(x1 + x2) / 2 + 20} y={19} textAnchor="middle" style={{ fontSize: 11, fontWeight: 700, fill: '#fff' }}>!</text>
                </g>
              )}
              <text x={(x1 + x2) / 2} y={50} textAnchor="middle" className="mode-fill" style={{ fontSize: 11, fontWeight: 600, ...inkVars(m) }}>
                {m.label}{m.perKm && ride.claimed_km != null ? ` · ${km(ride.claimed_km)}` : ride.map_km != null ? ` · ${km(ride.map_km)}` : ''}
              </text>
              <text x={(x1 + x2) / 2} y={66} textAnchor="middle" className="fill-ink-500" style={{ fontSize: 11 }}>{money(rideAmount(ride, rule))}</text>
            </g>
          )
        })}
        {stops.map((s, i) => {
          const x = EDGE + i * STEP, c = PIN[s.kind]
          const filled = s.kind === 'hospital' || s.kind === 'hotel' || s.kind === 'place'
          // The first name reads on from its dot and the last one back to it, so neither runs off the card
          // (the user, 18 Oct: "the first place name not seeing … and last also"); the rest sit centred.
          const first = i === 0, last = i === stops.length - 1 && stops.length > 1
          const anchor = first ? 'start' : last ? 'end' : 'middle'
          const tx = first ? x - 10 : last ? x + 10 : x
          return (
            <g key={i}>
              <title>{s.name}</title>
              <circle cx={x} cy={84} r={filled ? 10 : 9} fill={filled ? c : 'rgb(var(--surface))'} stroke={filled ? 'rgb(var(--surface))' : c} strokeWidth={3} />
              <text x={tx} y={116} textAnchor={anchor} className="fill-ink-900" style={{ fontSize: 12, fontWeight: 600 }}>
                {names[i].map((line, k) => <tspan key={k} x={tx} dy={k ? 15 : 0}>{line}</tspan>)}
              </text>
              {s.sub && <text x={tx} y={116 + names[i].length * 15} textAnchor={anchor} className="fill-ink-500" style={{ fontSize: 11 }}>{s.sub}</text>}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
/*
  The stops' names, each the place's own name (before the first comma), on one line or two so that
  no two touch: measured in the strip's own font, the first reading on from its dot, the last back to
  it, the rest centred, and the room between two dots shared — a short name leaves its neighbour
  more. A name too wide for its room wraps at a space onto a second line (the user, 19 Oct: "better
  wrap the locations if not fitting"); only when two lines are still not enough does it end in "…".
*/
let ctx: CanvasRenderingContext2D | null = null
function textWidth(t: string) {
  if (!ctx) {
    ctx = document.createElement('canvas').getContext('2d')
    if (ctx) ctx.font = `600 12px ${getComputedStyle(document.body).fontFamily}`
  }
  return ctx ? ctx.measureText(t).width : t.length * 7.2
}
/** The narrowest two lines a name breaks into at a space: the wider line's width, and the lines. */
function twoLines(t: string): { width: number; lines: string[] } {
  const words = t.split(/\s+/)
  let best = { width: textWidth(t), lines: [t] }
  for (let k = 1; k < words.length; k++) {
    const lines = [words.slice(0, k).join(' '), words.slice(k).join(' ')]
    const width = Math.max(...lines.map(textWidth))
    if (width < best.width) best = { width, lines }
  }
  return best
}
/** A line cut to the width, ending in "…". */
function cut(t: string, limit: number) {
  if (textWidth(t) <= limit) return t
  let k = t.length
  while (k > 1 && textWidth(t.slice(0, k).trimEnd() + '…') > limit) k--
  return t.slice(0, k).trimEnd() + '…'
}
function fitNames(full: string[], step: number): string[][] {
  const n = full.length, GAP = 10
  const want = full.map(x => x.split(',')[0].trim() || x)
  // The room each name asks for: its width on one line, or wrapped onto two.
  const wd = want.map(t => Math.min(textWidth(t), twoLines(t).width))
  // How far each name reaches left and right of its dot.
  const left = wd.map((x, i) => (i === 0 ? 10 : i === n - 1 && n > 1 ? x - 10 : x / 2))
  const right = wd.map((x, i) => (i === 0 ? x - 10 : i === n - 1 && n > 1 ? 10 : x / 2))
  const maxL = left.slice(), maxR = right.slice()
  for (let i = 0; i < n - 1; i++) {
    const room = step - GAP
    if (right[i] + left[i + 1] <= room) continue
    if (right[i] <= room / 2) maxL[i + 1] = room - right[i]
    else if (left[i + 1] <= room / 2) maxR[i] = room - left[i + 1]
    else { maxR[i] = room / 2; maxL[i + 1] = room / 2 }
  }
  return want.map((t, i) => {
    const limit = i === 0 ? maxR[i] + 10 : i === n - 1 && n > 1 ? maxL[i] + 10 : 2 * Math.min(maxL[i], maxR[i])
    if (textWidth(t) <= limit) return [t]
    // Words onto the first line while they fit; the rest onto the second, cut there if need be.
    const words = t.split(/\s+/)
    let k = 0
    while (k < words.length && textWidth(words.slice(0, k + 1).join(' ')) <= limit) k++
    if (k === 0) return [cut(t, limit)]
    const rest = words.slice(k).join(' ')
    return rest ? [words.slice(0, k).join(' '), cut(rest, limit)] : [words.join(' ')]
  })
}
