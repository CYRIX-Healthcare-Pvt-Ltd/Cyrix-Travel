import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Download, Loader2, X } from 'lucide-react'
import { useBackCloses } from '@/lib/useBackCloses'

/*
  A bill opened inside the app, never in another tab (the user, 17 Oct: "the things opening
  shouldn't go to a different tab, like clicking documents"). A photo is shown whole; a PDF is
  drawn page by page. Back or the cross closes it and leaves the claim where it was.
*/
export default function BillView({ url, name, onClose }: { url: string; name: string; onClose: () => void }) {
  useBackCloses(onClose)
  const pdf = /\.pdf($|\?)/i.test(name) || /\.pdf($|\?)/i.test(url.split('?')[0])
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])
  return createPortal(
    <div className="fixed inset-0 z-[60] flex flex-col bg-black/95" role="dialog" aria-modal="true" aria-label={name}>
      <div className="flex items-center gap-2 px-3 py-2.5 text-white">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{name}</span>
        <a href={url} download={name} className="grid h-10 w-10 place-items-center rounded-full bg-white/10 hover:bg-white/20" aria-label="Download" title="Download"><Download className="h-4.5 w-4.5" /></a>
        <button type="button" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full bg-white/10 hover:bg-white/20" aria-label="Close"><X className="h-5 w-5" /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {pdf ? <PdfPages url={url} /> : <img src={url} alt={name} className="mx-auto block max-w-full" />}
      </div>
    </div>,
    document.body,
  )
}

function PdfPages({ url }: { url: string }) {
  const box = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const pdfjs = await import('pdfjs-dist')
        pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
        const doc = await pdfjs.getDocument(url).promise
        const host = box.current
        if (!host || cancelled) return
        const width = Math.min((host.clientWidth || window.innerWidth) - 16, 1000), ratio = window.devicePixelRatio || 1
        for (let i = 1; i <= doc.numPages && !cancelled; i++) {
          const page = await doc.getPage(i)
          const vp = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width })
          const canvas = document.createElement('canvas')
          canvas.width = Math.floor(vp.width * ratio); canvas.height = Math.floor(vp.height * ratio)
          canvas.style.width = `${vp.width}px`; canvas.style.height = `${vp.height}px`
          canvas.className = 'mx-auto my-2 block bg-white shadow-lg'
          host.appendChild(canvas)
          await page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined }).promise
          if (i === 1) setState('ready')
        }
      } catch { if (!cancelled) setState('failed') }
    })()
    return () => { cancelled = true }
  }, [url])
  return (
    <>
      {state === 'loading' && <div className="grid place-items-center py-16 text-white"><Loader2 className="h-7 w-7 animate-spin" /></div>}
      {state === 'failed' && <p className="py-16 text-center text-sm text-white">This PDF could not be shown here. Use the download button.</p>}
      <div ref={box} className="px-2 pb-6" />
    </>
  )
}
