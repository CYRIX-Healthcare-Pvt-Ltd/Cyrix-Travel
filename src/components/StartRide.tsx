import type { ReactNode } from 'react'
import { Play } from 'lucide-react'
import { Spinner } from '@/components/ui'
import ModeArt from '@/components/ModeArt'
import { artOf } from '@/lib/modeArt'

/**
 * What the Start button shows while the trip is being started: the chosen
 * vehicle setting off, once.
 *
 * It rides in from the left and settles in the middle of the button, which
 * has turned into a strip of country in the mode's own colour — hills and
 * clouds far off, trees and houses nearer, the road underneath, each passing
 * at its own pace. It stays there, running, for as long as the phone takes
 * to say where it is; then it rides out to the right and the trip is on the
 * road.
 *
 * The first version sent the vehicle across again and again in black and
 * white on a bare button (the user, 1 Oct: "why bike is going many times?
 * and in background nothing and black n white animation not good"). So: one
 * arrival and one departure, in colour, with somewhere to be riding through.
 *
 * A train is a train: the engine comes with coaches behind it (the user:
 * "hope train will be long in start animation").
 *
 * The motion is in index.css ("Start, pressed"). With less motion asked
 * for, none of it is shown — a spinner and the word instead.
 */
export default function StartRide({ mode }: { mode: string }) {
  return (
    <>
      <span className="sr-only">Starting…</span>
      <span aria-hidden className="start-far"><Strip><Far /></Strip></span>
      <span aria-hidden className="start-near"><Strip><Near /></Strip></span>
      <span aria-hidden className="start-road" />
      <span aria-hidden className="start-rider">
        {/* A mode drawn as the train — a metro, say — is as long as one. */}
        {artOf(mode) === 'train' && (
          <>
            <ModeArt mode="coach" bare moving className="-mr-1 w-20" />
            <ModeArt mode="coach" bare moving className="-mr-2.5 w-20" />
          </>
        )}
        <ModeArt mode={mode} bare moving className="w-20" />
      </span>
      <span aria-hidden className="start-still"><Spinner className="h-5 w-5" /> Starting…</span>
      {/* Keeps the button the height it was. */}
      <span aria-hidden className="invisible inline-flex items-center gap-2"><Play className="h-5 w-5" /> Start</span>
    </>
  )
}

/**
 * What "Change here" shows while the mode is being changed: the engineer
 * leaving one vehicle for the next (the user, 1 Oct: "can animation be like
 * getting out from bike and starting auto and going?").
 *
 * The vehicle they came on stands at the left, in its own colour; the next
 * one waits ahead of it. A figure walks from the first to the second. Then
 * the second starts — wheels, road and country all begin together — and the
 * first is left behind, sliding back out of sight the way a parked thing
 * does from a moving one. When the change is made, the new vehicle rides
 * out. The strip is in the new mode's colour: it is where the trip is going.
 *
 * Timed in index.css ("Change here, pressed"). With less motion asked for,
 * a spinner and the word instead.
 */
export function SwapRide({ from, to, fromArt }: { from: string; to: string; /** The colour the vehicle being left is drawn in: its own. */ fromArt: string }) {
  return (
    <>
      <span className="sr-only">Changing…</span>
      <span aria-hidden className="start-far"><Strip><Far /></Strip></span>
      <span aria-hidden className="start-near"><Strip><Near /></Strip></span>
      <span aria-hidden className="start-road" />
      <span aria-hidden className={`swap-old ${fromArt}`}><ModeArt mode={from} bare className="w-20" /></span>
      <span aria-hidden className="swap-walker">
        <svg viewBox="0 0 12 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
          <circle cx={6} cy={3.6} r={2.3} fill="currentColor" stroke="none" />
          <path d="M6 7v8M6 9.2 3.2 12.6M6 9.2l2.8 3.4" />
          <path className="swap-leg-a" d="M6 15v7.2" />
          <path className="swap-leg-b" d="M6 15v7.2" />
        </svg>
      </span>
      <span aria-hidden className="swap-new"><ModeArt mode={to} bare moving className="w-20" /></span>
      <span aria-hidden className="start-still"><Spinner className="h-4 w-4" /> Changing…</span>
      {/* Keeps the button the height it was. */}
      <span aria-hidden className="invisible inline-flex items-center gap-2">Change here</span>
    </>
  )
}

/** One stretch of country, 320 wide, drawn three times side by side: the strip moves one stretch and is back where it began. */
function Strip({ children }: { children: ReactNode }) {
  return (
    <svg width={960} height={48} viewBox="0 0 960 48" fill="currentColor">
      {[0, 320, 640].map(x => <g key={x} transform={`translate(${x} 0)`}>{children}</g>)}
    </svg>
  )
}

/** Far off: two hills and two clouds. */
const Far = () => (
  <>
    <path opacity={0.13} d="M0 44C30 44 44 27 74 27s46 17 76 17zM130 44c32 0 46-25 82-25s52 25 86 25z" />
    <g opacity={0.2}>
      <rect x={38} y={8} width={28} height={6} rx={3} /><rect x={48} y={4.5} width={14} height={6} rx={3} />
      <rect x={214} y={11} width={22} height={5} rx={2.5} /><rect x={221} y={8} width={11} height={5} rx={2.5} />
    </g>
  </>
)

/** Nearer: trees, a house, a couple of buildings, standing on the same ground as the road. */
const Near = () => (
  <g opacity={0.24}>
    <rect x={29} y={32} width={2} height={11} /><circle cx={30} cy={28} r={7} />
    <path d="M98 43V31l11-8 11 8v12z" />
    <rect x={183} y={34} width={2} height={9} /><circle cx={184} cy={31} r={5} />
    <rect x={240} y={20} width={16} height={23} rx={1} /><rect x={259} y={29} width={11} height={14} rx={1} />
  </g>
)
