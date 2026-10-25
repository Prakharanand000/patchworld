import { watchFile } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { basename, resolve, sep } from 'node:path'
import { WebSocketServer, type RawData, type WebSocket } from 'ws'
import { decodePlaytestPacket, type WriteFilesMessage } from '../src/shared/protocol.ts'
import { checkGeneratedTypeScript, validateGeneratedFiles, type GeneratedFile } from './generatedFiles.ts'
import { ArgonOrchestrator, type OrchestratorEvent } from './argonOrchestrator.ts'

type ClientRole = 'browser' | 'agent'

interface ClientRecord {
  socket: WebSocket
  role: ClientRole
}

const host = '127.0.0.1'
const port = Number(process.env.ARGON_SYNC_PORT ?? 4174)
const projectRoot = process.cwd()
const generatedRoot = resolve(projectRoot, 'src/generated')
const artifactRoot = resolve(projectRoot, 'artifacts/playtests')
const maxBytes = 12 * 1024 * 1024
const allowedOrigin = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/
const clients = new Set<ClientRecord>()
const maxIterations = Math.min(20, Math.max(1, Number(process.env.ARGON_MAX_ITERATIONS) || 4))
const skillPath = resolve(projectRoot, '.agents/SKILL.md')
let goalEpoch = 0
let activeGoal = ''
let iteration = 0
let previousInteractionId: string | undefined
let awaitingLevelMount = false

function emitProgress(message: OrchestratorEvent): void {
  sendToRole('browser', { type: 'progress', iteration, maxIterations, ...message, timestamp: new Date().toISOString() })
}

function createOrchestrator(epoch: number): ArgonOrchestrator {
  return new ArgonOrchestrator((event) => { if (epoch === goalEpoch) emitProgress(event) })
}

async function publishSkill(socket?: WebSocket): Promise<void> {
  try {
    const skillContent = (await readFile(skillPath, 'utf8')).slice(0, 64000)
    const payload = { type: 'progress', phase: 'skill-evolving', message: 'Learned physics invariants updated.', skillContent, timestamp: new Date().toISOString() }
    if (socket) sendJson(socket, payload)
    else sendToRole('browser', payload)
  } catch { /* No learned skill has been published yet. */ }
}

async function persistSkill(content?: string): Promise<void> {
  if (!content?.trim()) return
  await mkdir(resolve(projectRoot, '.agents'), { recursive: true })
  await writeFile(skillPath, content.slice(0, 64000), 'utf8')
  await publishSkill()
}
watchFile(skillPath, { persistent: false, interval: 1000 }, () => { void publishSkill() })

async function readCurrentGeneratedFiles(): Promise<GeneratedFile[]> {
  const entries = await readdir(generatedRoot, { withFileTypes: true })
  return Promise.all(entries
    .filter((entry) => entry.isFile() && /\.(ts|glsl)$/.test(entry.name) && !entry.name.startsWith('.'))
    .map(async (entry) => ({
      path: `src/generated/${entry.name}`,
      content: await readFile(resolve(generatedRoot, entry.name), 'utf8'),
    })))
}

async function validateAndApply(files: GeneratedFile[], socket?: WebSocket, runId?: string, epoch = goalEpoch): Promise<boolean> {
  const safeFiles = validateGeneratedFiles(files)
  const diagnostics = await checkGeneratedTypeScript(safeFiles, projectRoot)
  if (diagnostics.length > 0) {
    if (socket) sendJson(socket, { type: 'patch-rejected', runId, diagnostics: diagnostics.join('\n') })
    sendToRole('agent', { type: 'patch-rejected', runId, diagnostics: diagnostics.join('\n') })
    return false
  }
  if (epoch !== goalEpoch) return false
  await writeBatch(safeFiles)
  const result = { type: 'patch-applied', runId, files: safeFiles.map(({ path }) => path) }
  if (socket) sendJson(socket, result)
  sendToRole('agent', result)
  sendToRole('browser', result)
  return true
}

async function startGoal(socket: WebSocket, goal: string): Promise<void> {
  if (!goal.trim() || goal.length > 2_000) {
    sendJson(socket, { type: 'goal-error', message: 'Enter a level goal between 1 and 2,000 characters.' })
    return
  }
  const epoch = ++goalEpoch
  activeGoal = goal.trim()
  iteration = 0
  previousInteractionId = undefined
  awaitingLevelMount = false
  sendToRole('browser', { type: 'start-goal-accepted', goal: activeGoal })
  try {
    const orchestrator = createOrchestrator(epoch)
    const patch = await orchestrator.generateInitialWorld(activeGoal, (files) => checkGeneratedTypeScript(validateGeneratedFiles(files), projectRoot))
    if (epoch !== goalEpoch) return
    iteration = 1
    awaitingLevelMount = true
    if (!await validateAndApply(patch.files, socket, patch.interactionId, epoch)) { awaitingLevelMount = false; return }
    previousInteractionId = patch.interactionId
    await persistSkill(patch.skillContent)
    emitProgress({ phase: 'hmr-pending', message: 'World generated; waiting for the browser to mount the updated module.', iteration })
  } catch (error) {
    if (epoch !== goalEpoch) return
    awaitingLevelMount = false
    const message = error instanceof Error ? error.message : String(error)
    sendJson(socket, { type: 'goal-error', message })
    emitProgress({ phase: 'error', message })
  }
}

async function critiqueFailedRun(packet: Awaited<ReturnType<typeof savePlaytestPacket>>, browserSocket: WebSocket): Promise<void> {
  if (!activeGoal) return
  const epoch = goalEpoch
  if (iteration >= maxIterations) {
    activeGoal = ''
    emitProgress({ phase: 'limit-reached', message: 'Iteration limit reached. Review the replay, take over, or start a new goal.' })
    return
  }
  try {
    emitProgress({ phase: 'critiquing', message: 'Managed Agent sandbox is reviewing the video and frame telemetry.', iteration })
    const currentFiles = await readCurrentGeneratedFiles()
    const patch = await createOrchestrator(epoch).critiqueAndPatchWorld({
      videoBytes: packet.videoBytes,
      metadata: packet.metadata,
      currentFiles,
      previousInteractionId,
      iteration,
    }, (files) => checkGeneratedTypeScript(validateGeneratedFiles(files), projectRoot))
    if (epoch !== goalEpoch) return
    emitProgress({ phase: 'diagnosis', message: patch.diagnosis ?? 'Patch is ready for the next playtest.', diagnosis: patch.diagnosis, iteration })
    iteration += 1
    awaitingLevelMount = true
    const applied = await validateAndApply(patch.files, browserSocket, packet.metadata.runId, epoch)
    if (!applied) { awaitingLevelMount = false; return }
    previousInteractionId = patch.interactionId
    await persistSkill(patch.skillContent)
    emitProgress({ phase: 'hmr-pending', message: 'Patch accepted; waiting for the updated level to mount.', iteration })
  } catch (error) {
    if (epoch !== goalEpoch) return
    awaitingLevelMount = false
    const message = error instanceof Error ? error.message : String(error)
    emitProgress({ phase: 'error', message, iteration })
  }
}

function sendJson(socket: WebSocket, payload: object): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload))
}

function parseJsonMessage(data: RawData): Record<string, unknown> {
  if (Array.isArray(data) || data instanceof ArrayBuffer) throw new Error('Expected a text message')
  const parsed: unknown = JSON.parse(data.toString())
  if (!parsed || typeof parsed !== 'object') throw new Error('Expected a JSON object')
  return parsed as Record<string, unknown>
}

function rawDataToBytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return Buffer.concat(data)
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  return data
}

async function writeBatch(files: GeneratedFile[]): Promise<void> {
  await mkdir(generatedRoot, { recursive: true })
  const staged: Array<{ temporary: string; destination: string }> = []

  try {
    for (const file of files) {
      const destination = resolve(projectRoot, file.path)
      if (!destination.startsWith(`${generatedRoot}${sep}`)) {
        throw new Error(`Resolved path escapes generated directory: ${file.path}`)
      }
      const temporary = `${destination}.${randomUUID()}.tmp`
      await writeFile(temporary, file.content, { encoding: 'utf8', flag: 'wx' })
      staged.push({ temporary, destination })
    }
    const entryModule = staged.find(({ destination }) => destination.endsWith(`${sep}activeLevel.ts`))
    for (const file of staged) {
      if (file !== entryModule) await rename(file.temporary, file.destination)
    }
    if (entryModule) {
      // Let Vite observe imported helper modules before it recompiles activeLevel.ts.
      if (staged.length > 1) await new Promise((resolvePromise) => setTimeout(resolvePromise, 80))
      await rename(entryModule.temporary, entryModule.destination)
    }
  } catch (error) {
    await Promise.all(staged.map(({ temporary }) => rm(temporary, { force: true })))
    throw error
  }
}

async function deleteGeneratedFiles(paths: unknown): Promise<string[]> {
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > 64) {
    throw new Error('Delete batch must contain 1 to 64 paths')
  }
  const safePaths = paths.map((path) => {
    if (typeof path !== 'string' || !/^src\/generated\/[A-Za-z0-9_.-]+\.(ts|glsl)$/.test(path)) {
      throw new Error(`Generated delete path is invalid: ${String(path)}`)
    }
    const fileName = basename(path)
    if (fileName.startsWith('.') || fileName.endsWith('.tmp')) {
      throw new Error(`Invalid generated filename: ${fileName}`)
    }
    return path
  })
  await Promise.all(safePaths.map((path) => rm(resolve(projectRoot, path), { force: true })))
  return safePaths
}

function sendToRole(role: ClientRole, payload: object): void {
  clients.forEach(({ role: clientRole, socket }) => {
    if (clientRole === role) sendJson(socket, payload)
  })
}

function forwardBinaryToRole(role: ClientRole, data: Uint8Array): void {
  clients.forEach(({ role: clientRole, socket }) => {
    if (clientRole === role && socket.readyState === socket.OPEN) socket.send(data, { binary: true })
  })
}

async function savePlaytestPacket(packetBytes: Uint8Array): Promise<ReturnType<typeof decodePlaytestPacket>> {
  const packet = decodePlaytestPacket(packetBytes)
  const { metadata, videoBytes } = packet
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(metadata.runId)) throw new Error('Invalid playtest runId')
  if (metadata.frameCount !== metadata.telemetry.length) {
    throw new Error('frameCount must match the telemetry frame count')
  }
  if (videoBytes.byteLength === 0) throw new Error('Failed playtest did not include a WebM payload')

  await mkdir(artifactRoot, { recursive: true })
  await writeFile(resolve(artifactRoot, `${metadata.runId}.webm`), videoBytes)
  await writeFile(
    resolve(artifactRoot, `${metadata.runId}.telemetry.json`),
    JSON.stringify(metadata, null, 2),
  )
  return packet
}

async function handleAgentMessage(socket: WebSocket, message: Record<string, unknown>): Promise<void> {
  if (message.type === 'start-playtest') {
    const maxFrames = typeof message.maxFrames === 'number'
      ? Math.max(1, Math.min(Math.floor(message.maxFrames), 240))
      : 240
    const browsers = [...clients].filter((client) => client.role === 'browser')
    if (browsers.length === 0) {
      sendJson(socket, { type: 'daemon-error', message: 'No browser engine is connected' })
      return
    }
    browsers.forEach(({ socket: browser }) => sendJson(browser, { type: 'start-playtest', maxFrames }))
    sendJson(socket, { type: 'playtest-started', maxFrames })
    return
  }

  if (message.type === 'delete-files') {
    try {
      const files = await deleteGeneratedFiles(message.paths)
      const result = { type: 'files-deleted', files }
      sendJson(socket, result)
      sendToRole('browser', result)
    } catch (error) {
      sendJson(socket, { type: 'patch-rejected', runId: message.runId, diagnostics: error instanceof Error ? error.message : 'Unable to delete generated files' })
    }
    return
  }

  if (message.type !== 'write-files' || !Array.isArray(message.files)) {
    sendJson(socket, { type: 'daemon-error', message: 'Unknown agent message type' })
    return
  }

  const writeMessage = message as unknown as WriteFilesMessage
  const runId = typeof message.runId === 'string' ? message.runId : undefined
  try {
    const files = validateGeneratedFiles(writeMessage.files)
    const diagnostics = await checkGeneratedTypeScript(files, projectRoot)
    if (diagnostics.length > 0) {
      sendJson(socket, { type: 'patch-rejected', runId, diagnostics: diagnostics.join('\n') })
      return
    }

    await writeBatch(files)
    const result = { type: 'patch-applied', runId, files: files.map(({ path }) => path) }
    sendJson(socket, result)
    sendToRole('browser', result)
  } catch (error) {
    sendJson(socket, {
      type: 'patch-rejected',
      runId,
      diagnostics: error instanceof Error ? error.message : 'Unable to apply generated files',
    })
  }
}

async function handleBrowserMessage(
  socket: WebSocket,
  data: RawData,
  isBinary: boolean,
): Promise<void> {
  if (isBinary) {
    try {
      const packet = await savePlaytestPacket(rawDataToBytes(data))
      sendJson(socket, { type: 'playtest-accepted', runId: packet.metadata.runId })
      forwardBinaryToRole('agent', rawDataToBytes(data))
      sendToRole('agent', { type: 'playtest-artifact-saved', runId: packet.metadata.runId })
      void critiqueFailedRun(packet, socket)
    } catch (error) {
      sendJson(socket, {
        type: 'daemon-error',
        message: error instanceof Error ? error.message : 'Unable to save playtest artifact',
      })
    }
    return
  }

  try {
    const message = parseJsonMessage(data)
    if (message.type === 'playtest-passed') {
      sendToRole('agent', message)
      activeGoal = ''
      emitProgress({ phase: 'complete', message: 'Goal reached. Human controls are available.' })
    } else if (message.type === 'pause-goal') {
      goalEpoch += 1
      activeGoal = ''
      awaitingLevelMount = false
      emitProgress({ phase: 'human', message: 'Autonomous loop paused. Human control enabled.' })
    }
    else if (message.type === 'start-goal' && typeof message.goal === 'string') void startGoal(socket, message.goal)
    else if (message.type === 'level-mounted') {
      sendToRole('browser', { type: 'progress', phase: 'hmr-swapped', message: 'Updated physics module mounted through Vite HMR.', timestamp: new Date().toISOString(), iteration })
      if (awaitingLevelMount) {
        awaitingLevelMount = false
        sendJson(socket, { type: 'start-playtest', maxFrames: 240 })
        emitProgress({ phase: 'recording', message: 'Recording the 8-second autonomous bot playtest.', iteration })
      }
    }
    else sendJson(socket, { type: 'daemon-error', message: 'Unknown browser message type' })
  } catch (error) {
    sendJson(socket, { type: 'daemon-error', message: error instanceof Error ? error.message : 'Invalid browser message' })
  }
}

const httpServer = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ service: 'argon-local-sync', status: 'ready' }))
})

const websocketServer = new WebSocketServer({
  server: httpServer,
  maxPayload: maxBytes + 1024 * 1024,
  verifyClient: ({ origin }, done) => {
    done(!origin || allowedOrigin.test(origin), origin ? 403 : 401, 'Localhost origin required')
  },
})

websocketServer.on('connection', (socket) => {
  let record: ClientRecord | null = null
  let writeTail = Promise.resolve()

  socket.on('message', (data, isBinary) => {
    if (!record) {
      try {
        const message = parseJsonMessage(data)
        if (message.type !== 'register' || (message.role !== 'browser' && message.role !== 'agent')) {
          throw new Error('First message must register role as browser or agent')
        }
        record = { socket, role: message.role }
        clients.add(record)
        sendJson(socket, { type: 'registered', role: record.role })
        if (record.role === 'browser') void publishSkill(socket)
      } catch (error) {
        sendJson(socket, { type: 'daemon-error', message: error instanceof Error ? error.message : 'Invalid registration' })
        socket.close(1008, 'Register client role first')
      }
      return
    }

    if (record.role === 'browser') {
      void handleBrowserMessage(socket, data, isBinary)
      return
    }

    writeTail = writeTail.then(async () => {
      try {
        if (isBinary) throw new Error('Agent messages must use JSON text frames')
        await handleAgentMessage(socket, parseJsonMessage(data))
      } catch (error) {
        sendJson(socket, { type: 'daemon-error', message: error instanceof Error ? error.message : 'Invalid agent message' })
      }
    })
  })

  socket.on('close', () => {
    if (record) clients.delete(record)
  })
})

httpServer.listen(port, host, () => {
  console.log(`[Argon sync] Listening on ws://${host}:${port}`)
  console.log(`[Argon sync] Writes are limited to ${generatedRoot}`)
  console.log(`[Argon sync] Failed playtests are saved under ${artifactRoot}`)
})
