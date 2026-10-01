/** The platform's tones, as Revive Lab names them: literal classes, so Tailwind keeps them. */
export type Tone = 'red' | 'amber' | 'sky' | 'indigo' | 'teal' | 'green' | 'violet' | 'orange' | 'rose' | 'slate' | 'blue' | 'cyan'

/** Badge colours per tone, light and dark both — the tokens flip underneath. */
export const TONE_CLASS: Record<Tone, string> = {
  red: 'bg-cyrixRed-100 text-cyrixRed-900',
  amber: 'bg-amber-100 text-amber-900',
  sky: 'bg-sky-100 text-sky-900',
  indigo: 'bg-indigo-100 text-indigo-900',
  teal: 'bg-teal-100 text-teal-900',
  green: 'bg-green-100 text-green-900',
  violet: 'bg-violet-100 text-violet-900',
  orange: 'bg-orange-100 text-orange-900',
  rose: 'bg-rose-100 text-rose-900',
  slate: 'bg-slate-100 text-slate-900',
  blue: 'bg-blue-100 text-blue-900',
  cyan: 'bg-cyan-100 text-cyan-900',
}

/** An icon on a soft patch of its colour. */
export const TONE_SOFT: Record<Tone, string> = {
  red: 'bg-cyrixRed-100 text-cyrixRed-700',
  amber: 'bg-amber-100 text-amber-700',
  sky: 'bg-sky-100 text-sky-700',
  indigo: 'bg-indigo-100 text-indigo-700',
  teal: 'bg-teal-100 text-teal-700',
  green: 'bg-green-100 text-green-700',
  violet: 'bg-violet-100 text-violet-700',
  orange: 'bg-orange-100 text-orange-700',
  rose: 'bg-rose-100 text-rose-700',
  slate: 'bg-slate-100 text-slate-700',
  blue: 'bg-blue-100 text-blue-700',
  cyan: 'bg-cyan-100 text-cyan-700',
}

/** An icon in its colour on a plain ground. */
export const TONE_TEXT: Record<Tone, string> = {
  red: 'text-cyrixRed-600',
  amber: 'text-amber-600',
  sky: 'text-sky-600',
  indigo: 'text-indigo-500',
  teal: 'text-teal-600',
  green: 'text-green-600',
  violet: 'text-violet-500',
  orange: 'text-orange-600',
  rose: 'text-rose-600',
  slate: 'text-slate-500',
  blue: 'text-blue-600',
  cyan: 'text-cyan-600',
}
