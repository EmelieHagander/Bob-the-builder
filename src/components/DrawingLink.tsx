import { Link, type LinkProps } from 'react-router-dom'
import { useOpenDrawing } from '../lib/drawingNavigation'

export function DrawingLink({ projectId, returnLabel, returnKey, to, onClick, ...props }:
  Omit<LinkProps, 'to' | 'state'> & { to: string; projectId: string; returnLabel: string; returnKey: string }) {
  const open = useOpenDrawing(projectId, returnLabel)
  return <Link {...props} to={to} data-drawing-return={returnKey} onClick={event => {
    onClick?.(event)
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || props.target) return
    event.preventDefault(); open(to, returnKey)
  }} />
}
