import { useQuery } from '@tanstack/react-query'
import { supabase, friendlyError } from './supabase'
import { lineKm, placeName, type Fix } from './geo'
import { newId, sha256 } from './claims'

/*
  Visit photos (te_0082; the user, 28 Oct: "when he reaches a hospital … he can take a photo of the facility, so no
  upload option only camera and in that photo date, time a location should be watermarked"). Taken in the app's own
  camera, stamped on the phone, kept in the private bucket te-visits; a ride for a purpose that needs one finds the
  photo taken that day nearest where it went.
*/
export interface VisitSetup { on: boolean; near_m: number; skips: number; after: 'block' | 'send'; keep_days: number; needs: string[] }
export interface VisitPhoto {
  id: string; day: string; shot_at: string; taken_at: string; lat: number; lng: number; accuracy: number | null
  place: string | null; path: string | null
  /** The phone it was taken on: the app's own id for that phone and its model (te_0086). */
  device_id?: string | null; device?: string | null
  /** The claim it stands on: its number, 'draft', or none (te_my_photos only). */
  on?: string | null
}

const rpc = async <T,>(fn: string, args?: Record<string, unknown>) => {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(friendlyError(error))
  return data as T
}

export const useVisitSetup = () => useQuery({ queryKey: ['te_visit_setup'], queryFn: () => rpc<VisitSetup>('te_visit_setup'), staleTime: 5 * 60_000 })
export const useMyPhotos = (from: string, to: string) =>
  useQuery({ queryKey: ['te_my_photos', from, to], queryFn: () => rpc<VisitPhoto[]>('te_my_photos', { p_from: from, p_to: to }) })

const firstPart = (s: string | null | undefined) => (s ?? '').split(',')[0].trim()

/** A ride whose purpose asks for a visit photo, to somewhere that is not home. */
export const needsPhoto = (r: { purpose?: string | null; to_name: string | null; to_lat: number | null }, s?: VisitSetup | null) =>
  !!s?.on && !!r.purpose && s.needs.includes(r.purpose) && r.to_lat != null && firstPart(r.to_name).toLowerCase() !== 'home'

/** The photo taken that day nearest where the ride went, within reach. */
export function photoFor(r: { to_lat: number | null; to_lng: number | null }, day: string, photos: VisitPhoto[] | undefined, nearM: number) {
  if (r.to_lat == null || r.to_lng == null) return null
  let best: { photo: VisitPhoto; m: number } | null = null
  for (const p of photos ?? []) {
    if (p.day !== day) continue
    const m = lineKm({ lat: p.lat, lng: p.lng }, { lat: r.to_lat, lng: r.to_lng }) * 1000
    if (m <= nearM && (!best || m < best.m)) best = { photo: p, m }
  }
  return best
}

/** Uploaded this long after it was taken, said beside it (a phone with no signal at the hospital sends it later). */
export const lateBy = (p: VisitPhoto) => {
  const h = (new Date(p.taken_at).getTime() - new Date(p.shot_at).getTime()) / 3_600_000
  return h >= 2 ? `uploaded ${h >= 48 ? `${Math.round(h / 24)} days` : `${Math.round(h)} h`} later` : null
}

export const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\s/g, ' ')
export const metres = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10 || Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`)

/** Short-lived links for pictures this person may see (the bucket's own rule decides). */
export function usePhotoUrls(paths: Array<string | null | undefined>) {
  const list = [...new Set(paths.filter((p): p is string => !!p))].sort()
  return useQuery({
    queryKey: ['te_visit_urls', list],
    enabled: list.length > 0,
    staleTime: 8 * 60_000,
    queryFn: async () => {
      const { data } = await supabase.storage.from('te-visits').createSignedUrls(list, 600)
      return Object.fromEntries((data ?? []).filter(x => x.signedUrl).map(x => [x.path, x.signedUrl])) as Record<string, string>
    },
  })
}

/** The place for the stamp: a hospital we have learned within 500 m, else what the map calls the spot. */
export async function stampPlace(fix: Fix) {
  const { data } = await supabase.rpc('te_visit_place', { p_lat: fix.lat, p_lng: fix.lng })
  if (typeof data === 'string' && data.trim()) return data.trim()
  const n = await placeName(fix)
  return n ? n.split(', ').slice(0, 2).join(', ') : null
}

/** The frame at the press, at most 1600 px on its long side. */
export function grab(video: HTMLVideoElement) {
  const w0 = video.videoWidth, h0 = video.videoHeight, k = Math.min(1, 1600 / Math.max(w0, h0))
  const cv = document.createElement('canvas')
  cv.width = Math.round(w0 * k); cv.height = Math.round(h0 * k)
  cv.getContext('2d')!.drawImage(video, 0, 0, cv.width, cv.height)
  return cv
}

/** The date, time, place, point and who, printed along the frame's foot. */
export function stamp(cv: HTMLCanvasElement, at: Date, fix: Fix, place: string | null, who: string) {
  const w = cv.width, h = cv.height, g = cv.getContext('2d')!
  const lines = [
    `${at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} · ${at.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })}`,
    place ?? 'Place not named',
    `${fix.lat.toFixed(5)}, ${fix.lng.toFixed(5)} · ±${Math.round(fix.accuracy)} m`,
    who,
  ]
  const fs = Math.max(14, Math.round(Math.min(w, h) * 0.034)), pad = Math.round(fs * 0.6), lh = Math.round(fs * 1.3)
  const band = pad * 2 + lh * lines.length
  g.fillStyle = 'rgba(0,0,0,0.55)'
  g.fillRect(0, h - band, w, band)
  g.fillStyle = '#fff'
  g.textBaseline = 'top'
  lines.forEach((t, i) => {
    g.font = `${i === 0 ? 600 : 400} ${fs}px system-ui, sans-serif`
    let s = t
    while (g.measureText(s).width > w - pad * 2 && s.length > 4) s = s.slice(0, -2)
    g.fillText(s === t ? t : s + '…', pad, h - band + pad + i * lh)
  })
  return new Promise<Blob>((ok, no) => cv.toBlob(b => (b ? ok(b) : no(new Error('The photo could not be made'))), 'image/jpeg', 0.82))
}

/*
  Which phone (te_0086; the user, 30 Oct: a friend signed in as someone takes the photo at another hospital). A website
  cannot read a phone's IMEI, so the app gives each phone an id of its own on first use, kept on the phone, and names
  its model where the browser tells it.
*/
const DEVICE_KEY = 'te.device'
export function deviceId() {
  try {
    const had = localStorage.getItem(DEVICE_KEY)
    if (had) return had
    const id = newId()
    localStorage.setItem(DEVICE_KEY, id)
    return id
  } catch { return null }
}
export async function deviceName() {
  const ua = navigator.userAgent
  type Hints = { getHighEntropyValues?: (h: string[]) => Promise<{ model?: string; platform?: string; platformVersion?: string }> }
  try {
    const hints = await (navigator as Navigator & { userAgentData?: Hints }).userAgentData?.getHighEntropyValues?.(['model', 'platform', 'platformVersion'])
    if (hints?.model) return `${hints.model} (${hints.platform ?? 'Android'}${hints.platform === 'Android' && hints.platformVersion ? ' ' + hints.platformVersion.split('.')[0] : ''})`
    if (hints?.platform) return hints.platform
  } catch { /* only a name */ }
  const ios = ua.match(/(iPhone|iPad).*?OS (\d+)/)
  if (ios) return `${ios[1]} (iOS ${ios[2]})`
  const android = ua.match(/Android (\d+)(?:; ([^;)]+))?/)
  if (android) return android[2] && android[2] !== 'K' ? `${android[2].trim()} (Android ${android[1]})` : `Android ${android[1]}`
  return /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : null
}

export interface Pending { id: string; blob: Blob; employee: string; fix: Fix; shot_at: string; place: string | null }

/** Into the bucket, then recorded; a refusal from the database takes the picture back out. */
export async function sendPhoto(p: Pending) {
  const path = `${p.employee}/${p.id}.jpg`
  const hash = await sha256(p.blob)
  const { error: up } = await supabase.storage.from('te-visits').upload(path, p.blob, { contentType: 'image/jpeg', upsert: false })
  if (up && !/exists|duplicate/i.test(up.message)) throw new Error(friendlyError(up))
  const { error } = await supabase.rpc('te_photo_add', {
    p_path: path, p_lat: p.fix.lat, p_lng: p.fix.lng, p_acc: Math.round(p.fix.accuracy), p_shot_at: p.shot_at, p_place: p.place, p_sha256: hash,
    p_device_id: deviceId(), p_device: await deviceName(),
  })
  if (error) {
    await supabase.storage.from('te-visits').remove([path])
    const e = new Error(friendlyError(error)) as Error & { refused?: boolean }
    e.refused = true
    throw e
  }
}

export async function deletePhoto(id: string) {
  const path = await rpc<string>('te_photo_delete', { p_id: id })
  await supabase.storage.from('te-visits').remove([path])
}

export const newPending = (blob: Blob, employee: string, fix: Fix, at: Date, place: string | null): Pending =>
  ({ id: newId(), blob, employee, fix, shot_at: at.toISOString(), place })

/*
  Photos taken with no signal wait on the phone (IndexedDB) and go when it is back. A browser that refuses the store
  keeps them for as long as the page is open.
*/
const memory: Pending[] = []
const db = () => new Promise<IDBDatabase>((ok, no) => {
  const r = indexedDB.open('te-visits', 1)
  r.onupgradeneeded = () => r.result.createObjectStore('queue', { keyPath: 'id' })
  r.onsuccess = () => ok(r.result)
  r.onerror = () => no(r.error)
})
async function store<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>) {
  const d = await db()
  return new Promise<T>((ok, no) => { const q = f(d.transaction('queue', mode).objectStore('queue')); q.onsuccess = () => ok(q.result); q.onerror = () => no(q.error) })
}
export async function queuePhoto(p: Pending) {
  try { await store('readwrite', s => s.put(p)) } catch { memory.push(p) }
}
export async function queued(employee: string): Promise<Pending[]> {
  let saved: Pending[] = []
  try { saved = await store<Pending[]>('readonly', s => s.getAll() as IDBRequest<Pending[]>) } catch { /* memory only */ }
  return [...saved, ...memory].filter(p => p.employee === employee)
}
async function unqueue(id: string) {
  try { await store('readwrite', s => s.delete(id)) } catch { /* memory only */ }
  const i = memory.findIndex(p => p.id === id)
  if (i >= 0) memory.splice(i, 1)
}
/** Sends what waits; a photo the database refuses is dropped with its reason, one that fails for the network waits on. */
export async function flushQueue(employee: string) {
  const refused: string[] = []
  let sent = 0
  for (const p of await queued(employee)) {
    try { await sendPhoto(p); await unqueue(p.id); sent++ }
    catch (e) { if ((e as { refused?: boolean }).refused) { await unqueue(p.id); refused.push((e as Error).message) } }
  }
  return { sent, refused }
}
