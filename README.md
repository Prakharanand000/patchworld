# Patchworld

An arcade-inspired physics playground with a persistent Three.js/Rapier viewport, generated levels, state-preserving Vite HMR, synchronized WebM and physics telemetry, and a localhost WebSocket broker. Prompt submissions use the configured Google generation and managed-agent APIs; the local dry-run needs no API credits.

## Interface

The React frontend uses Tailwind CSS, locally bundled Pixelify Sans/Sora/IBM Plex Mono fonts, and Lucide icons. `src/components/` contains the persistent viewport, prompt and three presets, live status ticker, replay card, Workshop drawer, and human controls. `src/hooks/useSandbox.ts` maps real engine and daemon events into UI state. The pixel island is an empty-state illustration and disappears when a level mounts.

Take over cancels the autonomous run and exposes the generated level's human controls. Reset remounts the current module without replacing the renderer. Feature twists submit a revised world goal. The Workshop displays actual terminal events and published SKILL.md contents.

## Run locally

```bash
npm run dev
```

This starts Vite (normally `http://localhost:5173`, or the next available port) and the sync daemon at `ws://127.0.0.1:4174`. Open the Vite page so the engine registers as a `browser` client. The canvas starts empty until a generated level adds scene objects. For live generation, configure `GEMINI_API_KEY=...` in a local `.env` file (plain assignments, not shell commands). Credentials remain server-side. Restart the daemon after editing its environment.

## Generated module contract

The entry module is `src/generated/activeLevel.ts` and exports `buildWorld(scene, world, namedBodies, eventQueue)`. It returns a `MountedLevel` with `stepBotAndRules(frameIndex, elapsedSeconds)` and `dispose()`, plus optional pointer/key handling. The host keeps the renderer, camera, scene lighting, and WebSocket connection while swapping the level and Rapier world.

The daemon typechecks proposed `.ts` files against the current app in memory before writing any file. A failed check returns the formatted TypeScript diagnostics to the agent. Valid batches are staged as temporary files, moved into `src/generated/` with `activeLevel.ts` last, then Vite HMR remounts the module. The entry and its imported helpers are typechecked together.

## Closed-loop playtest protocol

An agent registers with `{"type":"register","role":"agent"}` and starts a run with `{"type":"start-playtest","maxFrames":240}`. The browser runs up to 480 physics ticks at 60 Hz and records 240 telemetry samples plus canvas video at 30 FPS (eight seconds). On a failed run, it sends a binary WebSocket packet containing a four-byte JSON-header length, the `PLAYTEST_FAILED_PAYLOAD` metadata and frame ledger, then the WebM bytes. The daemon stores the artifact locally and forwards the packet to connected agents.

The agent returns a patch using `{"type":"write-files","runId":"...","files":[{"path":"src/generated/activeLevel.ts","content":"..."}]}`. The daemon checks it before writing. A valid HMR mount automatically starts the next run. A successful run returns `playtest-passed` to connected agents. Contact-force telemetry requires generated colliders to enable `RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS`.

## Verify locally

```bash
npm test
npm run build
```

With `npm run dev` running and the browser page open, `npm run dry-run` pushes a temporary two-file level, captures a 240-sample failure, sends a successful patch through HMR, and restores the starter level and removes its artifacts.

Failed video and ledger artifacts are stored under the ignored `artifacts/playtests/` directory for real runs. The dry-run removes its own artifacts and temporary generated modules when it finishes.
