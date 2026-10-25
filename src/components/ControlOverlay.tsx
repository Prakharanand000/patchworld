import { useState, type FormEvent } from 'react'
import { ArrowUpRight, Gamepad2, Keyboard, MousePointer2, RotateCcw, Sparkles } from 'lucide-react'

export function ControlOverlay({ active, onTakeOver, onReset, onTwist, busy }: { active: boolean; onTakeOver: () => void; onReset: () => void; onTwist: (twist: string) => void; busy: boolean }) {
  const [twist, setTwist] = useState('')
  const submit = (event: FormEvent) => { event.preventDefault(); if (twist.trim()) { onTwist(twist.trim()); setTwist('') } }
  return <section className={`control-overlay glass-panel ${active ? 'controls-active' : ''}`} aria-label="Human control">
    <div className="control-row"><div className="control-label"><Gamepad2 size={16} /><span>{active ? 'PLAYER CONTROL' : 'BOT AT PLAY'}</span></div>{active ? <div className="control-shortcuts"><span><Keyboard size={13} />Keys <i>Level controls</i></span><span><MousePointer2 size={13} />Click <i>Interact</i></span></div> : <span className="control-hint">Step into the simulation.</span>}<div className="ml-auto flex gap-2"><button className="quiet-button" onClick={onReset} disabled={busy}><RotateCcw size={13} /><span>Reset level</span></button>{!active && <button className="takeover-button" onClick={onTakeOver}><Gamepad2 size={13} />Take over</button>}</div></div>
    {active && <form onSubmit={submit} className="twist-form"><Sparkles size={14} /><label htmlFor="world-twist" className="sr-only">Add a twist to the world</label><input id="world-twist" value={twist} onChange={(e) => setTwist(e.target.value)} placeholder="Add a twist… lower gravity, a moving target, one more obstacle" maxLength={800} /><button disabled={!twist.trim() || busy} type="submit" aria-label="Apply feature twist"><ArrowUpRight size={17} /></button></form>}
  </section>
}
