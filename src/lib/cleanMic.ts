/*
  RNNoise on the feedback microphone (the user, 14 Nov: "add RNNoise … in our feedback also in travel exp").
  Open source (xiph/rnnoise, BSD) through @sapphi-red/web-noise-suppressor (MIT), run on the phone itself: fans, engines,
  traffic and hospital hum are taken out before the clip is recorded; voices stay. Nothing goes to any other service.

  cleanMic(raw) hands back a stream to record: the cleaned one, or the raw microphone when RNNoise cannot run here
  (no AudioWorklet, a 48 kHz context refused, the audio not starting, 5 s without loading). It never throws.
*/

export type CleanMic = { stream: MediaStream; cleaned: boolean; close: () => void }

/** Made inside the button press, so a phone lets it run; 48 kHz is what RNNoise works at. */
export function micContext(): AudioContext | null {
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  try {
    return new Ctor({ sampleRate: 48000 })
  } catch {
    return null
  }
}

let wasm: Promise<ArrayBuffer> | null = null

export async function cleanMic(raw: MediaStream, ctx: AudioContext | null): Promise<CleanMic> {
  const plain: CleanMic = { stream: raw, cleaned: false, close: () => { ctx?.close().catch(() => {}) } }
  if (!ctx || ctx.sampleRate !== 48000 || !ctx.audioWorklet) return plain
  try {
    await ctx.resume().catch(() => {})
    if (ctx.state !== 'running') return plain
    const load = (async () => {
      const [lib, worklet, url, simd] = await Promise.all([
        import('@sapphi-red/web-noise-suppressor'),
        import('@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url'),
        import('@sapphi-red/web-noise-suppressor/rnnoise.wasm?url'),
        import('@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url'),
      ])
      wasm ??= lib.loadRnnoise({ url: url.default, simdUrl: simd.default })
      const [binary] = await Promise.all([wasm, ctx.audioWorklet.addModule(worklet.default)])
      return new lib.RnnoiseWorkletNode(ctx, { maxChannels: 1, wasmBinary: binary })
    })()
    const node = await Promise.race([load, new Promise<null>(r => setTimeout(() => r(null), 5000))])
    if (!node) return plain
    const src = ctx.createMediaStreamSource(raw)
    const dest = ctx.createMediaStreamDestination()
    src.connect(node)
    node.connect(dest)
    return {
      stream: dest.stream,
      cleaned: true,
      close: () => {
        try { node.destroy() } catch { /* already gone */ }
        ctx.close().catch(() => {})
      },
    }
  } catch (e) {
    wasm = null
    console.warn('RNNoise unavailable, recording the plain microphone', e)
    return plain
  }
}
