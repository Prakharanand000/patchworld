import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, Clapperboard, ScanLine, MessageSquareText, CircleCheck } from 'lucide-react'
import type { SandboxState } from '../hooks/useSandbox'

export function PiPCard({ state }: { state: SandboxState }) {
  const [open, setOpen] = useState(false)
  const replay = state.replay
  useEffect(() => { if (replay) setOpen(true) }, [replay])
  return <aside className={`pip-panel glass-panel ${open && replay ? 'pip-open' : ''} ${replay?.failed ? 'pip-failed' : ''}`} aria-label="Playtest replay and critique">
    <button className="pip-toggle" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="replay-content">
      <span className="flex items-center gap-2.5"><Clapperboard size={15} /><span className="micro-label">INSTANT REPLAY</span></span>
      <span className="flex items-center gap-2"><span className="replay-count">{replay ? `ITER ${String(replay.iteration).padStart(2, '0')}${state.maxIterations ? ` / ${String(state.maxIterations).padStart(2, '0')}` : ''}` : 'NO REPLAYS YET'}</span>{open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}</span>
    </button>
    {open && <div id="replay-content">
      {replay ? <div className="replay-video-wrap"><video key={replay.runId} src={replay.videoUrl} autoPlay loop controls muted playsInline aria-label="Recorded bot attempt" /><span className={`replay-result ${replay.failed ? '' : 'passed'}`}>{replay.failed ? <ScanLine size={11} /> : <CircleCheck size={11} />}{replay.failed ? 'FAILED ATTEMPT' : 'GOAL REACHED'}</span></div> : <div className="replay-empty"><ScanLine size={27} strokeWidth={1} /><span>No attempts recorded yet.</span><small>The next bot run will appear here.</small></div>}
      <div className="critique-block"><div className="flex items-center justify-between"><span className="micro-label flex items-center gap-2"><MessageSquareText size={12} /> BUILDER NOTES</span><span className="micro-label opacity-50">{state.diagnosisTime ? new Date(state.diagnosisTime).toLocaleTimeString([], { hour12: false }) : '—'}</span></div><p>{state.diagnosis || replay?.failureReason || 'Every attempt teaches the builder something new.'}</p></div>
    </div>}
  </aside>
}
