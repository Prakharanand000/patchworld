import type { FrameSnapshot } from '../engine/TelemetryRecorder'

export interface PlaytestFailedMetadata {
  type: 'PLAYTEST_FAILED_PAYLOAD'
  runId: string
  frameCount: number
  failureReason?: string
  telemetry: FrameSnapshot[]
}

export interface PlaytestPassedMessage {
  type: 'playtest-passed'
  runId: string
  frameCount: number
}

export type DaemonMessage =
  | { type: 'registered'; role: 'browser' | 'agent' }
  | { type: 'progress'; phase: string; message: string; timestamp: string; iteration?: number; maxIterations?: number; diagnosis?: string; terminal?: string; skillContent?: string }
  | { type: 'video-preview'; runId: string; videoUrl: string }
  | { type: 'start-goal-accepted'; goal: string }
  | { type: 'goal-error'; message: string }
  | { type: 'start-playtest'; maxFrames?: number }
  | { type: 'playtest-accepted'; runId: string }
  | { type: 'playtest-started'; maxFrames: number }
  | PlaytestPassedMessage
  | { type: 'patch-applied'; runId?: string; files: string[] }
  | { type: 'patch-rejected'; runId?: string; diagnostics: string }
  | { type: 'daemon-error'; message: string }

export interface DecodedPlaytestPacket {
  metadata: PlaytestFailedMetadata
  videoBytes: Uint8Array
}

export interface GeneratedFilePayload {
  path: string
  content: string
}

export interface WriteFilesMessage {
  type: 'write-files'
  runId?: string
  files: GeneratedFilePayload[]
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function encodePlaytestPacket(metadata: PlaytestFailedMetadata, videoBytes: Uint8Array): Uint8Array {
  const header = encoder.encode(JSON.stringify(metadata))
  const packet = new Uint8Array(4 + header.byteLength + videoBytes.byteLength)
  new DataView(packet.buffer).setUint32(0, header.byteLength)
  packet.set(header, 4)
  packet.set(videoBytes, 4 + header.byteLength)
  return packet
}

export function decodePlaytestPacket(packet: Uint8Array): DecodedPlaytestPacket {
  if (packet.byteLength < 4) throw new Error('Playtest packet header is truncated')
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength)
  const headerLength = view.getUint32(0)
  if (headerLength === 0 || headerLength > packet.byteLength - 4) {
    throw new Error('Playtest packet header length is invalid')
  }

  let metadata: unknown
  try {
    metadata = JSON.parse(decoder.decode(packet.subarray(4, 4 + headerLength))) as unknown
  } catch {
    throw new Error('Playtest packet header is not valid JSON')
  }
  if (
    !metadata ||
    typeof metadata !== 'object' ||
    (metadata as Partial<PlaytestFailedMetadata>).type !== 'PLAYTEST_FAILED_PAYLOAD' ||
    typeof (metadata as Partial<PlaytestFailedMetadata>).runId !== 'string' ||
    typeof (metadata as Partial<PlaytestFailedMetadata>).frameCount !== 'number' ||
    !Array.isArray((metadata as Partial<PlaytestFailedMetadata>).telemetry)
  ) {
    throw new Error('Playtest packet metadata is invalid')
  }

  return {
    metadata: metadata as PlaytestFailedMetadata,
    videoBytes: packet.slice(4 + headerLength),
  }
}
