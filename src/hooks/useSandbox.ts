import { useEffect, useState } from 'react'

export interface AgentLog { id: number; timestamp: string; message: string; kind: 'activity' | 'terminal' | 'error' }
export interface Replay { runId: string; videoUrl: string; failed: boolean; failureReason?: string; iteration: number; frameCount: number }
export interface SandboxState {
  connected: boolean; ready: boolean; hasLevel: boolean; phase: string; message: string;
  frame: number; frameLimit: number; bodyCount: number; iteration: number; maxIterations?: number;
  diagnosis: string; diagnosisTime: string; replay: Replay | null; logs: AgentLog[];
  skillContent: string; skillUpdated: string; goal: string; error: string; human: boolean;
}
const initial: SandboxState = {
  connected: false, ready: false, hasLevel: false, phase: 'idle', message: 'Ready for your first world',
  frame: 0, frameLimit: 240, bodyCount: 0, iteration: 0, diagnosis: '', diagnosisTime: '',
  replay: null, logs: [], skillContent: '', skillUpdated: '', goal: '', error: '', human: false,
}

export function useSandbox() {
  const [state, setState] = useState<SandboxState>(initial)
  useEffect(() => {
    let lastVideo = ''
    let sequence = 0
    const log = (s: SandboxState, message: string, kind: AgentLog['kind'] = 'activity', timestamp = new Date().toISOString()) =>
      s.logs.at(-1)?.message === message ? s.logs : [...s.logs.slice(-149), { id: ++sequence, timestamp, message, kind }]
    const bindings: [string, EventListener][] = []
    const listen = <T,>(name: string, handler: (detail: T) => void) => {
      const listener: EventListener = (e) => handler((e as CustomEvent<T>).detail)
      window.addEventListener(name, listener); bindings.push([name, listener])
    }
    listen<boolean>('argon:connection', (connected) => setState((s) => ({ ...s, connected, logs: log(s, connected ? 'Local sync connection established.' : 'Sync disconnected. Reconnecting…') })))
    listen<{ hasLevel: boolean; bodyCount: number }>('argon:level-mounted', (detail) => setState((s) => ({ ...s, ...detail, ready: true, ...(detail.hasLevel ? {} : { human: false, phase: 'idle', frame: 0 }) })))
    listen<{ frame: number; total: number; bodyCount: number }>('argon:frame', (d) => setState((s) => ({ ...s, phase: 'running', frame: d.frame, frameLimit: d.total, bodyCount: d.bodyCount })))
    listen<{ phase: string; message: string; timestamp: string; iteration?: number; maxIterations?: number; diagnosis?: string; terminal?: string; skillContent?: string }>('argon:progress', (d) => {
      setState((s) => ({
        ...s, phase: d.terminal ? s.phase : d.skillContent ? (s.phase === 'idle' ? 'idle' : 'skill-evolving') : d.phase === 'hmr-swapped' && !s.hasLevel ? 'idle' : d.phase === 'thinking' && s.phase === 'critiquing' ? s.phase : d.phase,
        message: d.message, iteration: d.iteration ?? s.iteration, maxIterations: d.maxIterations ?? s.maxIterations,
        diagnosis: d.diagnosis ?? s.diagnosis, diagnosisTime: d.diagnosis ? d.timestamp : s.diagnosisTime,
        skillContent: d.skillContent ?? s.skillContent, skillUpdated: d.skillContent ? d.timestamp : s.skillUpdated,
        error: d.phase === 'error' ? d.message : s.error,
        logs: log(s, d.terminal ?? d.message, d.terminal ? 'terminal' : d.phase === 'error' ? 'error' : 'activity', d.timestamp),
      }))
    })
    listen<string>('argon:playtest-state', (phase) => setState((s) => ({ ...s, phase, human: phase === 'human' || phase === 'complete', frame: phase === 'running' ? 0 : s.frame, iteration: phase === 'running' ? Math.max(1, s.iteration) : s.iteration })))
    listen<Omit<Replay, 'iteration'>>('argon:video-preview', (replay) => {
      if (lastVideo) URL.revokeObjectURL(lastVideo)
      lastVideo = replay.videoUrl
      setState((s) => ({ ...s, replay: { ...replay, iteration: Math.max(1, s.iteration) } }))
    })
    listen<string>('argon:goal-submitted', (goal) => setState((s) => ({ ...s, goal, error: '', phase: 'synthesizing', human: false, diagnosis: '', diagnosisTime: '', iteration: 0, frame: 0 })))
    listen<string>('argon:goal-error', (error) => setState((s) => ({ ...s, error, phase: 'error', logs: log(s, error, 'error') })))
    listen<{ diagnostics: string }>('argon:patch-rejected', (d) => setState((s) => ({ ...s, error: d.diagnostics, phase: 'error', logs: log(s, d.diagnostics, 'error') })))
    return () => { bindings.forEach(([name, handler]) => window.removeEventListener(name, handler)); if (lastVideo) URL.revokeObjectURL(lastVideo) }
  }, [])
  return state
}
