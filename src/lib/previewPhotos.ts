import type { VisitPhoto } from '@/lib/visits'

/*
  Locally only, ?photos-preview: five sample visit photos in today's From and To, drawn here, to see the picker with a
  full row (the user, 3 Nov: "can you show how it will look if this screen has 5 visit photos, with take visit photo button").
*/
// Kept for the tab once seen, as the day page is reached through the claim's own links.
export const photosPreview = (() => {
  if (!import.meta.env.DEV) return false
  try {
    if (new URLSearchParams(window.location.search).has('photos-preview')) sessionStorage.setItem('photos-preview', '1')
    return sessionStorage.getItem('photos-preview') === '1'
  } catch { return false }
})()

const art = (sky: string, wall: string) => 'data:image/svg+xml,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 56"><rect width="96" height="56" fill="${sky}"/>` +
  `<rect x="22" y="14" width="52" height="42" fill="${wall}"/><rect x="42" y="38" width="12" height="18" fill="#334155"/>` +
  [0, 1, 2].map(r => [0, 1, 2, 3].map(c => `<rect x="${27 + c * 12}" y="${18 + r * 7}" width="6" height="4" fill="#bae6fd"/>`).join('')).join('') +
  `<rect x="43" y="6" width="10" height="10" fill="#fff"/><rect x="47" y="7" width="2" height="8" fill="#dc2626"/><rect x="44" y="10" width="8" height="2" fill="#dc2626"/></svg>`)

const at = (h: number, m: number) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.toISOString() }
export const previewPhotos = (day: string): VisitPhoto[] => ([
  ['MAJ Hospital, Edappally', 10, 10, 10.0261, 76.3125, '#93c5fd', '#f1f5f9'],
  ['District Hospital Aluva', 11, 42, 10.1076, 76.3517, '#a5b4fc', '#fef3c7'],
  ['Rajagiri Hospital, Chunangamvely', 13, 5, 10.0951, 76.3889, '#7dd3fc', '#e2e8f0'],
  ['Lakeshore Hospital, Maradu', 14, 50, 9.9412, 76.3186, '#bfdbfe', '#fae8ff'],
  ['General Hospital, Ernakulam', 16, 20, 9.9745, 76.2848, '#c7d2fe', '#ecfccb'],
] as const).map(([place, h, m, lat, lng, sky, wall], i) => ({
  id: `preview-${i}`, day, shot_at: at(h, m), taken_at: at(h, m), lat, lng, accuracy: 12, place, path: art(sky, wall),
}) as VisitPhoto)
