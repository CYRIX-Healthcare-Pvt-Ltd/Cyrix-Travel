import { useEffect, useRef, useState } from 'react'
import { MODES, km, money, rideAmount, type Day, type Rule } from '@/lib/claims'

/*
  A day's (or a trip's) route, drawn (the user, 17 Oct: "a graphical representation that show from
  to, in between km and cost"): each stop a dot — home green, a change of mode grey, a hospital red,
  a hotel violet — and each ride the road between them in its mode's colour, with its mode, km and cost.
*/
const MIN_STEP = 150
const PIN = { home: '#1D9E75', change: '#888780', hospital: '#E24B4A', hotel: '#7F77DD', place: '#E24B4A' }

export default function RouteStrip({ days, rule }: { days: Day[]; rule: Rule | undefined }) {
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
  const STEP = Math.max(MIN_STEP, stops.length > 1 ? (room - 100) / (stops.length - 1) : MIN_STEP)
  const w = Math.max(320, (stops.length - 1) * STEP + 100)
  const totalKm = rides.reduce((t, r) => t + (r.map_km ?? r.claimed_km ?? 0), 0)
  const totalCost = rides.reduce((t, r) => t + rideAmount(r, rule), 0)
  return (
    <div ref={box} className="overflow-x-auto">
      <svg viewBox={`0 0 ${w} 172`} width={w} height={172} role="img" className="max-w-none">
        <title>Route</title>
        {segs.map(({ from, ride }) => {
          const m = MODES[ride.mode]
          const x1 = 50 + from * STEP, x2 = 50 + (from + 1) * STEP
          return (
            <g key={ride.id}>
              <line x1={x1} y1={84} x2={x2} y2={84} stroke={m.color} strokeWidth={5} strokeLinecap="round" />
              <m.icon x={(x1 + x2) / 2 - 9} y={14} width={18} height={18} color={m.color} strokeWidth={2.2} />
              <text x={(x1 + x2) / 2} y={50} textAnchor="middle" style={{ fontSize: 11, fontWeight: 600, fill: m.color }}>
                {m.label}{m.perKm && ride.claimed_km != null ? ` · ${km(ride.claimed_km)}` : ride.map_km != null ? ` · ${km(ride.map_km)}` : ''}
              </text>
              <text x={(x1 + x2) / 2} y={66} textAnchor="middle" className="fill-ink-500" style={{ fontSize: 11 }}>{money(rideAmount(ride, rule))}</text>
            </g>
          )
        })}
        {stops.map((s, i) => {
          const x = 50 + i * STEP, c = PIN[s.kind]
          const filled = s.kind === 'hospital' || s.kind === 'hotel' || s.kind === 'place'
          return (
            <g key={i}>
              <circle cx={x} cy={84} r={filled ? 10 : 9} fill={filled ? c : 'rgb(var(--surface))'} stroke={filled ? 'rgb(var(--surface))' : c} strokeWidth={3} />
              <text x={x} y={116} textAnchor="middle" className="fill-ink-900" style={{ fontSize: 12, fontWeight: 600 }}>{trim(s.name)}</text>
              {s.sub && <text x={x} y={131} textAnchor="middle" className="fill-ink-500" style={{ fontSize: 11 }}>{s.sub}</text>}
            </g>
          )
        })}
        <text x={w / 2} y={160} textAnchor="middle" className="fill-ink-500" style={{ fontSize: 12 }}>
          {km(totalKm)} · {money(totalCost)} travel{tickets.length ? ` · ${tickets.length} ticket${tickets.length > 1 ? 's' : ''}` : ''}
        </text>
      </svg>
    </div>
  )
}
const trim = (s: string) => (s.length > 20 ? s.slice(0, 19) + '…' : s)
