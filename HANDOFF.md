# Patchworld handoff

## Goal
Bright arcade / pixel-inspired frontend for the persistent self-healing physics sandbox. Patchworld is the working product name; Argon remains an internal model/protocol name.

## Implementation
- `src/App.tsx`, `src/components/`, `src/hooks/useSandbox.ts`, `src/index.css`: componentized UI, real progress/replay/terminal/skill events, local fonts, responsive fixed overlays.
- `src/engine/EngineHost.ts`, `AutonomousLoop.ts`: persistent canvas, resize caching, reset, human takeover and recorder cancellation.
- `server/syncDaemon.ts`: pre-HMR typecheck, entry commit fix, iteration limit, stale-response cancellation, skill publication.
- `server/argonOrchestrator.ts`: Google SDK interaction/file API shapes and real tool-output forwarding.
- `vite.config.ts`: Tailwind integration and heavy library chunks. `tsconfig.server.json`: backend build checking.

## Verification
- Final `npm run build` passed with no warnings (frontend and backend typechecked).
- Final `npm test`: 5 tests passed, 0 failures.
- Workshop open/close and SKILL.md tab checked in the browser; preview saved as `patchworld-preview.png`.
- Local no-credit dry-run passed: 240-frame failure, 598734 WebM bytes + telemetry; HMR retry reached goal at frame 60. Temporary generated files/artifacts restored/removed.
- Desktop 1280x720 appearance inspected in browser.
- Live provider generation was not verified: earlier credential smoke found no usable GEMINI_API_KEY assignment in `.env`. Never expose its contents.

## Running
`npm run dev`: Vite currently at localhost:5174, daemon ws://127.0.0.1:4174. Server changes require restart; frontend uses HMR. Run `npm run build`, `npm test`, and (with open browser) `npm run dry-run` for verification. Do not submit live presets without intending to use provider credits.
