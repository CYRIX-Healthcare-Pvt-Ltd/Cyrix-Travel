import type { ReactNode } from 'react'
import clsx from 'clsx'

/**
 * Each way of travelling, as its own vehicle in its own colour.
 *
 * A mode keeps its colour wherever it appears — the picker, the trip on the
 * road, a claim's legs, the rates — so it is known before its name is read.
 * The colours are a fifth of the wheel apart or more, except the bike's
 * orange and the auto's yellow, which are the colours those two are.
 *
 * The vehicles are drawn side-on in a 48 x 30 box, facing right, each in
 * three parts the stylesheet can move (index.css, "The mode a trip is on"):
 * the ground under it, the body on its springs, and the wheels on their
 * hubs. A wheel is filled with the colour of the patch behind it, so the
 * body does not show through the spokes — that is what --scene is for.
 */

interface ModeLook {
  /** The patch the vehicle stands on, at rest and when it is the chosen one. */
  scene: string
  sceneOn: string
  /** The vehicle's own line. */
  art: string
  /** The whole tile, chosen. */
  on: string
  /** The tick on the chosen tile. */
  tick: string
  /** A strip of the colour, and a pill in it. */
  bar: string
  pill: string
}

const LOOK: Record<string, ModeLook> = {
  bike: {
    scene: '[--scene:rgb(var(--orange-100))]', sceneOn: '[--scene:rgb(var(--orange-200))]', art: 'text-orange-700',
    on: 'border-orange-400 bg-orange-100 text-orange-900 ring-1 ring-orange-400', tick: 'bg-orange-700',
    bar: 'bg-orange-500', pill: 'bg-orange-100 text-orange-900',
  },
  car: {
    scene: '[--scene:rgb(var(--fuchsia-100))]', sceneOn: '[--scene:rgb(var(--fuchsia-200))]', art: 'text-fuchsia-700',
    on: 'border-fuchsia-400 bg-fuchsia-100 text-fuchsia-900 ring-1 ring-fuchsia-400', tick: 'bg-fuchsia-700',
    bar: 'bg-fuchsia-500', pill: 'bg-fuchsia-100 text-fuchsia-900',
  },
  bus: {
    scene: '[--scene:rgb(var(--emerald-100))]', sceneOn: '[--scene:rgb(var(--emerald-200))]', art: 'text-emerald-700',
    on: 'border-emerald-400 bg-emerald-100 text-emerald-900 ring-1 ring-emerald-400', tick: 'bg-emerald-700',
    bar: 'bg-emerald-500', pill: 'bg-emerald-100 text-emerald-900',
  },
  train: {
    scene: '[--scene:rgb(var(--blue-100))]', sceneOn: '[--scene:rgb(var(--blue-200))]', art: 'text-blue-700',
    on: 'border-blue-400 bg-blue-100 text-blue-900 ring-1 ring-blue-400', tick: 'bg-blue-700',
    bar: 'bg-blue-500', pill: 'bg-blue-100 text-blue-900',
  },
  auto: {
    scene: '[--scene:rgb(var(--yellow-100))]', sceneOn: '[--scene:rgb(var(--yellow-200))]', art: 'text-yellow-700',
    on: 'border-yellow-400 bg-yellow-100 text-yellow-900 ring-1 ring-yellow-400', tick: 'bg-yellow-700',
    bar: 'bg-yellow-500', pill: 'bg-yellow-100 text-yellow-900',
  },
}

/** A mode the app has no drawing for yet: plain, so it is neither broken nor mistaken for another. */
const PLAIN: ModeLook = {
  scene: '[--scene:rgb(var(--slate-100))]', sceneOn: '[--scene:rgb(var(--slate-200))]', art: 'text-slate-700',
  on: 'border-slate-400 bg-slate-100 text-slate-900 ring-1 ring-slate-400', tick: 'bg-slate-700',
  bar: 'bg-slate-500', pill: 'bg-slate-100 text-slate-900',
}

export const modeLook = (mode: string | null | undefined): ModeLook => LOOK[mode ?? ''] ?? PLAIN

const SOFT = { fill: 'currentColor', fillOpacity: 0.16 } as const
const GLASS = { fill: 'currentColor', fillOpacity: 0.34, stroke: 'none' } as const
const two = (v: number) => Math.round(v * 100) / 100

/** Three spokes: a wheel at rest looks like a wheel, and one that turns can be seen turning. */
function Wheel({ x, y, r }: { x: number; y: number; r: number }) {
  const s = r - 0.9
  return (
    <g transform={`translate(${x} ${y})`}>
      <g className="m-wheel">
        <circle r={r} fill="var(--scene)" />
        <path d={`M0 0V${two(-s)}M0 0 ${two(0.866 * s)} ${two(0.5 * s)}M0 0 ${two(-0.866 * s)} ${two(0.5 * s)}`} strokeWidth={0.9} />
        <circle r={0.8} fill="currentColor" stroke="none" />
      </g>
    </g>
  )
}

/** The road: dashes that pass underneath. Drawn wider than the box, so there is always more to come. */
const Road = () => (
  <g className="m-ground" strokeWidth={1.2} opacity={0.55}>
    <path d="M-7 28H57" strokeDasharray="5 4" />
  </g>
)

/** The track: a rail that stays, and the sleepers that pass. */
const Rails = () => (
  <>
    <path d="M0 27H48" strokeWidth={1.1} opacity={0.55} />
    <g className="m-ground m-ties" strokeWidth={1.1} opacity={0.5}>
      <path d="M-4 27v1.9M2 27v1.9M8 27v1.9M14 27v1.9M20 27v1.9M26 27v1.9M32 27v1.9M38 27v1.9M44 27v1.9M50 27v1.9" />
    </g>
  </>
)

/** The air left behind: seen only while moving. */
const Wind = ({ lines }: { lines: Array<[x: number, y: number, long: number]> }) => (
  <g strokeWidth={1.2}>
    {lines.map(([x, y, long], i) => <path key={i} className={`m-wind m-wind-${i + 1}`} d={`M${x} ${y}h${long}`} />)}
  </g>
)

const ART: Record<string, () => ReactNode> = {
  bike: () => (
    <>
      <Road />
      <Wind lines={[[2.5, 12.5, 5], [1, 16.5, 4], [3.5, 20.5, 3.5]]} />
      <g className="m-body">
        <path d="M34.5 22.3 29.8 12.2M27.7 11.6h3.7" />
        <path d="M13.5 22.3 20.6 19.8M16.6 17.1 13.5 22.3" />
        <path {...SOFT} d="M14.6 15.1h6.6q1 0 1.6.8 1.7-3 4.7-2.9 2.4.1 3.1 2L29.4 17.2H16.6q-1.7 0-2-2.1z" />
        <path {...SOFT} d="M21.8 17.6h4.4q1.2 0 1.2 1.2v1.8q0 1.2-1.2 1.2h-4.4q-1.2 0-1.2-1.2v-1.8q0-1.2 1.2-1.2z" />
        <circle cx={31.9} cy={14.7} r={1.05} fill="currentColor" stroke="none" />
      </g>
      <Wheel x={13.5} y={22.3} r={3.5} />
      <Wheel x={34.5} y={22.3} r={3.5} />
    </>
  ),
  car: () => (
    <>
      <Road />
      <Wind lines={[[1.5, 13, 5], [0.5, 17, 4], [2.5, 21, 3.5]]} />
      <g className="m-body">
        <path {...SOFT} d="M9.5 22.5V19q0-2.1 2.1-2.5l4.6-.8 3.1-4.1q.8-1.1 2.2-1.1h6.1q1.4 0 2.3 1l3.7 4.1 3.3.6q2.1.5 2.1 2.6v2.4q0 1.3-1.3 1.3z" />
        <path {...GLASS} d="M18.6 15.3 20.9 12.3h3.3v3z" />
        <path {...GLASS} d="M25.8 12.3h2.2l3.2 3h-5.4z" />
        <path d="M39 18.7h-1.7M9.5 19h1.3" strokeWidth={1.3} />
      </g>
      <Wheel x={16.5} y={22.6} r={3.2} />
      <Wheel x={32.2} y={22.6} r={3.2} />
    </>
  ),
  bus: () => (
    <>
      <Road />
      <Wind lines={[[0.5, 11.5, 4.5], [0, 15.5, 3.5], [1, 19.5, 4]]} />
      <g className="m-body">
        <path {...SOFT} d="M7.5 20.8V10.7q0-2.1 2.1-2.1h26.6q2 0 2.7 1.9l1.4 4.1q.2.6.2 1.3v4.9q0 1.7-1.7 1.7H9.2q-1.7 0-1.7-1.7z" />
        <path {...GLASS} d="M10.2 11.2h4.6v4.2h-4.6zM16.3 11.2h4.6v4.2h-4.6zM22.4 11.2H27v4.2h-4.6zM28.5 11.2h4.6v4.2h-4.6zM34.8 11.2H37l1.4 4.2h-3.6z" />
        <path d="M7.5 18.4h33" strokeWidth={1} opacity={0.6} />
      </g>
      <Wheel x={15.3} y={22.7} r={3.1} />
      <Wheel x={33} y={22.7} r={3.1} />
    </>
  ),
  train: () => (
    <>
      <Rails />
      <Wind lines={[[0, 12, 4], [0, 16, 3]]} />
      <g className="m-body">
        <path d="M15.2 9.4 18 6.3l2.8 3.1M15.8 6.3h4.4" strokeWidth={1.2} />
        <path {...SOFT} d="M5.5 22V11.4q0-2 2-2h25q4.1 0 6.7 3.6l2.7 4q1.1 1.7.7 3.2-.5 1.8-2.6 1.8z" />
        <path {...GLASS} d="M8 12h4.2v3.6H8zM13.6 12h4.2v3.6h-4.2zM19.2 12h4.2v3.6h-4.2zM24.8 12H29v3.6h-4.2zM30.6 12h2q2.4 0 4 2l1.2 1.6h-7.2z" />
        <path d="M5.5 18.5h36.7" strokeWidth={1} opacity={0.6} />
      </g>
      <Wheel x={11.5} y={24.4} r={2.1} />
      <Wheel x={16.9} y={24.4} r={2.1} />
      <Wheel x={30.1} y={24.4} r={2.1} />
      <Wheel x={35.5} y={24.4} r={2.1} />
    </>
  ),
  /* Three wheels: the small one out in front under the nose, the open cabin under its hood. */
  auto: () => (
    <>
      <Road />
      <Wind lines={[[1.5, 12, 5], [0.5, 16, 4], [2.5, 20, 3.5]]} />
      <g className="m-body">
        <path {...SOFT} d="M11 22.6v-9q0-5.4 5.4-5.4h9.8q2.2 0 3.3 2l2.7 5.4 4.4 1.6q1.8.7 1.8 2.2 0 1.1-1.2 1.1H32l-1.4 2.1z" />
        <path {...GLASS} d="M13.6 18v-4.4q0-2.6 2.6-2.6h4.6v7zM22.8 11H26q1.3 0 1.9 1.2l2.7 5.8h-7.8z" />
        <path d="M11 18h20.4" strokeWidth={1} opacity={0.6} />
        <circle cx={36.9} cy={18.7} r={0.75} fill="currentColor" stroke="none" />
      </g>
      <Wheel x={17} y={22.7} r={3.1} />
      <Wheel x={35.3} y={23.4} r={2.4} />
    </>
  ),
}

/** For a mode with no drawing: the way ahead, on the road. */
const Plain = () => (
  <>
    <Road />
    <g className="m-body">
      <path {...SOFT} d="M31 8.5 17 14.6l6.2 2 2 6.2z" />
    </g>
  </>
)

/**
 * A mode's vehicle on a patch of its colour. `moving` runs it; `chosen`
 * deepens the patch, for when the tile around it has taken the colour too.
 * Give it a width — the height follows, 48 to 30.
 */
export default function ModeArt({ mode, moving = false, chosen = false, className }: {
  mode: string
  moving?: boolean
  chosen?: boolean
  className?: string
}) {
  const look = modeLook(mode)
  const Art = ART[mode] ?? Plain
  return (
    <span aria-hidden className={clsx('block shrink-0 overflow-hidden bg-[var(--scene)]', chosen ? look.sceneOn : look.scene, look.art, moving && 'mode-on', className)}>
      <svg className="mode-art block h-auto w-full" data-mode={mode} viewBox="0 0 48 30" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
        <Art />
      </svg>
    </span>
  )
}
