# Argon Engine Agent Rules

## Google GenAI API

- Use `@google/genai` (`GoogleGenAI`) and the Interactions API. Do not use `@google/generative-ai`, `getGenerativeModel`, `models.generateContent`, or other legacy calls.
- Read `GEMINI_API_KEY` only on the Node server from `.env` through `dotenv/config`. Never expose it to Vite client code, generated files, browser messages, logs, or commits.
- Long world generation uses `ai.interactions.create({ model: 'gemini-4-argon', background: true, input, generation_config: { max_output_tokens, thinking_level } })`. Poll with `ai.interactions.get(id)` until `completed`; handle `failed`, `cancelled`, and `requires_action` as failures.
- Managed Agent critique uses `ai.interactions.create({ agent: 'antigravity-preview-09-2026', environment: 'remote', previous_interaction_id, input, background: true })`. Include the environment on chained Agent interactions.
- Upload WebM with `ai.files.upload({ file: localPath, config: { mimeType: 'video/webm' } })`. Use it as Interactions input `{ type: 'video', uri: uploaded.uri, mime_type: uploaded.mimeType }` followed by text content.
- The current SDK types use `generation_config` for model generation settings. Keep examples aligned with `node_modules/@google/genai` types and current official Google documentation.

## Generated Physics Levels

- Generated modules must live directly under `src/generated/`, export `buildWorld`, and implement the host contract in `src/engine/types.ts`.
- Typecheck the entire proposed batch before replacing any live generated file. On type errors, send the diagnostics through the current interaction chain for one repair attempt, then reject if errors remain.
- Never use `eval`, `new Function`, remote script loading, or a full page reload for level replacement. Keep the host alive and use Vite HMR.
- Keep the Gemini API key on the server. Only level goals, bounded telemetry, WebM bytes, diagnostics, and progress messages may cross the local WebSocket.
