import { useCallback, useEffect, useState } from 'react'
import { SHEET_ZOOM_MAX, useSheetZoom } from '../lib/useSheetZoom'
import './StorageBoxDrawing.css'

/** Room the viewport gives an image: `.box-drawing-viewport` is at most 72vh tall. */
const VIEWPORT_HEIGHT = 0.72

/**
 * An image people can read closely: pinch or Ctrl/⌘ + wheel to zoom, drag to move,
 * or the +/− buttons. `width` fits the image to the viewport width (drawing sheets);
 * `contain` also keeps a tall photo within the viewport height at 100 %.
 */
export function ZoomableImage({ src, alt, label, fit = 'contain', imgClassName, onError }: {
  src: string; alt: string; label: string; fit?: 'width' | 'contain'; imgClassName?: string; onError?: () => void
}) {
  const { viewport, zoom, panning, pan, zoomBy, reset } = useSheetZoom()
  const [fitted, setFitted] = useState(1)
  const measure = useCallback(() => {
    const frame = viewport.current, image = frame?.querySelector('img')
    if (fit !== 'contain' || !frame || !image?.naturalWidth || !frame.clientWidth) { setFitted(1); return }
    const room = window.innerHeight * VIEWPORT_HEIGHT - 2
    setFitted(Math.min(1, room * image.naturalWidth / image.naturalHeight / frame.clientWidth))
  }, [fit, viewport])
  useEffect(() => {
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [measure])
  return <div className="zoomable-image">
    <div className="foundation-actions box-drawing-controls">
      <button type="button" className="btn" onClick={() => zoomBy(-0.5)} disabled={zoom <= 1} aria-label={`Zoom ${label} out`}>−</button>
      <span aria-live="polite">{Math.round(zoom * 100)}%</span>
      <button type="button" className="btn" onClick={() => zoomBy(0.5)} disabled={zoom >= SHEET_ZOOM_MAX} aria-label={`Zoom ${label} in`}>+</button>
      <button type="button" className="btn" onClick={reset} disabled={zoom === 1}>Reset zoom</button>
    </div>
    <div ref={viewport} {...pan} className={`box-drawing-viewport sheet-pan${panning ? ' is-panning' : ''}`} tabIndex={0}
      aria-label={`${label}. Pinch or Ctrl + scroll to zoom, drag to move.`}>
      <div className="box-drawing-sheet" style={{ width: `${zoom * fitted * 100}%`, margin: '0 auto' }}>
        <img src={src} alt={alt} className={imgClassName} draggable={false} decoding="async" onLoad={measure} onError={onError} />
      </div>
    </div>
  </div>
}
