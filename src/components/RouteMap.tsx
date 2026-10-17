import { useEffect, useRef, useState } from 'react'
import { useBackCloses } from '@/lib/useBackCloses'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import 'leaflet/dist/leaflet.css'
import { MODES, MODE_ORDER, km, money, rideAmount, roadKm, type Day, type Rule } from '@/lib/claims'

/*
  "See on map" (the user, 17 Oct): the day's rides on OpenStreetMap along the real roads, each in its
  mode's colour with its mode, km and cost. Hovering a ride (its road, its label or its row) lifts it
  and dims the rest; clicking a pin lifts only that pin, with its name beside it.
*/
const PIN = { home: '#1D9E75', change: '#888780', hospital: '#E24B4A', hotel: '#7F77DD' }

export default function RouteMap({ days, rule, title, onClose }: { days: Day[]; rule: Rule | undefined; title: string; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  const [rows, setRows] = useState<Array<{ label: string; mode: keyof typeof MODES; claimed: number | null; map: number | null; cost: number }>>([])
  const [total, setTotal] = useState<number | null>(null)
  const lift = useRef<(k: number | null) => void>(() => {})
  const rides = days.flatMap(d => d.rides).filter(r => r.from_lat != null && r.to_lat != null)
  useBackCloses(onClose)

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  useEffect(() => {
    let map: import('leaflet').Map | null = null
    let alive = true
    void (async () => {
      const L = (await import('leaflet')).default
      if (!box.current || !alive) return
      map = L.map(box.current)
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map)
      const stops: Array<{ name: string; lat: number; lng: number }> = []
      rides.forEach((r, i) => {
        if (i === 0 || rides[i - 1].to_name !== r.from_name) stops.push({ name: r.from_name ?? '', lat: r.from_lat!, lng: r.from_lng! })
        stops.push({ name: r.to_name ?? '', lat: r.to_lat!, lng: r.to_lng! })
      })
      const all: [number, number][] = stops.map(s => [s.lat, s.lng])
      if (all.length) map.fitBounds(all, { padding: [40, 40] })
      const kind = (n: string, i: number): keyof typeof PIN => /home/i.test(n) ? 'home' : /hotel|lodge/i.test(n) ? 'hotel' : /hospital|clinic|medical|lab/i.test(n) || i === stops.length - 1 ? 'hospital' : 'change'
      const pins = stops.map((s, i) => L.marker([s.lat, s.lng], {
        icon: L.divIcon({ className: '', html: `<div class="rm-pin" style="background:${PIN[kind(s.name, i)]}">${i + 1}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] }),
      }).addTo(map!).bindTooltip(s.name, { direction: 'right', offset: [14, 0], className: 'rm-tip' }))
      let solo: number | null = null
      pins.forEach((m, i) => {
        m.on('mouseover', () => { m.getElement()?.querySelector('.rm-pin')?.classList.add('solo'); m.openTooltip() })
        m.on('mouseout', () => { if (solo !== i) { m.getElement()?.querySelector('.rm-pin')?.classList.remove('solo'); m.closeTooltip() } })
      })
      pins.forEach((m, i) => m.on('click', () => {
        pins.forEach((p, j) => { const on = j === i && solo !== i; p.getElement()?.querySelector('.rm-pin')?.classList.toggle('solo', on); if (on) p.openTooltip(); else p.closeTooltip() })
        solo = solo === i ? null : i
      }))
      const parts: Array<{ line: import('leaflet').Polyline; edge: import('leaflet').Polyline; label: import('leaflet').Marker }> = []
      lift.current = (k) => parts.forEach((p, i) => {
        const on = i === k, any = k !== null
        p.line.setStyle({ weight: on ? 10 : 6 }); p.edge.setStyle({ weight: on ? 15 : 0, opacity: on ? 1 : 0 })
        p.line.getElement()?.classList.toggle('up', on); p.line.getElement()?.classList.toggle('dim', any && !on)
        p.label.getElement()?.querySelector('.rm-km')?.classList.toggle('up', on); p.label.getElement()?.classList.toggle('dim', any && !on)
        if (on) p.line.bringToFront()
      })
      let sum = 0
      const out: typeof rows = []
      for (let i = 0; i < rides.length; i++) {
        const r = rides[i], m = MODES[r.mode]
        const road = await roadKm({ name: '', lat: r.from_lat!, lng: r.from_lng! }, { name: '', lat: r.to_lat!, lng: r.to_lng! })
        if (!alive || !map) return
        const line = road?.line ?? [[r.from_lat!, r.from_lng!], [r.to_lat!, r.to_lng!]]
        all.push(...line)
        sum += road?.km ?? r.map_km ?? 0
        const edge = L.polyline(line, { color: '#fff', weight: 0, opacity: 0 }).addTo(map)
        const pl = L.polyline(line, { color: m.color, weight: 6, opacity: 0.95, className: 'rm-line' }).addTo(map)
        const mid = line[Math.floor(line.length / 2)]
        const label = L.marker(mid, { icon: L.divIcon({ className: '', html: `<div class="rm-km" style="background:${m.bg};color:${m.fg}">${m.label} · ${km(road?.km ?? r.map_km)} · ${money(rideAmount(r, rule))}</div>`, iconSize: undefined }) }).addTo(map)
        const k = i
        parts.push({ line: pl, edge, label })
        for (const t of [pl, label]) { t.on('mouseover', () => lift.current(k)); t.on('mouseout', () => lift.current(null)) }
        out.push({ label: `${r.from_name ?? ''} → ${r.to_name ?? ''}`, mode: r.mode, claimed: r.claimed_km, map: road?.km ?? r.map_km, cost: rideAmount(r, rule) })
      }
      if (all.length) map.fitBounds(all, { padding: [30, 30] })
      setRows(out); setTotal(sum)
    })()
    return () => { alive = false; map?.remove() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const used = MODE_ORDER.filter(c => rides.some(r => r.mode === c))
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-shade/70 sm:items-center sm:p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div className="flex max-h-full w-full flex-col overflow-hidden bg-surface sm:max-w-3xl sm:rounded-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 p-4">
          <div>
            <h2 className="text-base font-semibold text-ink-900">{title}</h2>
            <p className="text-sm text-ink-500">{total == null ? 'Working out the road…' : `${km(total)} by road · ${money(rides.reduce((t, r) => t + rideAmount(r, rule), 0))} travel`}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="btn-icon"><X className="h-5 w-5" /></button>
        </div>
        <div ref={box} className="h-[55vh] min-h-[280px] w-full" />
        <div className="flex flex-wrap gap-1.5 px-4 pt-3">
          {used.map(c => (
            <span key={c} className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-semibold" style={{ background: MODES[c].bg, color: MODES[c].fg }}>
              <i className="inline-block h-1 w-3.5 rounded" style={{ background: MODES[c].color }} />{MODES[c].label}
            </span>
          ))}
        </div>
        <div className="overflow-y-auto px-4 pb-4 pt-2">
          {rows.map((r, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border-t border-ink-100 px-1.5 py-2 text-sm hover:bg-ink-100/60"
              onMouseEnter={() => lift.current(i)} onMouseLeave={() => lift.current(null)}>
              <span className="text-ink-500">{i + 1} → {i + 2}</span>
              <span className="text-ink-900">{r.label}</span>
              <span className="rounded-md px-2 py-0.5 text-xs font-semibold" style={{ background: MODES[r.mode].bg, color: MODES[r.mode].fg }}>{MODES[r.mode].label}</span>
              <span className="rounded-md bg-ink-100 px-2 py-0.5 text-xs text-ink-700">
                {r.claimed != null ? `Claimed ${km(r.claimed)} · ` : ''}Map {km(r.map)}
              </span>
              <span className="rounded-md bg-ink-100 px-2 py-0.5 text-xs text-ink-700">{money(r.cost)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  )
}
