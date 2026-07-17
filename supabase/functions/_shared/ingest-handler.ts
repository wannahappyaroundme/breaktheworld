import {
  validateAnalyticsBatch,
  type AnalyticsPayload,
} from './analytics-contract.ts'

const MAX_BODY_BYTES = 16_384

export type RpcError = { code?: string }
export type RpcResult = { error: RpcError | null }
export interface AnalyticsRpcClient {
  rpc(name: string, parameters: Record<string, unknown>): Promise<RpcResult>
}

function counts(accepted: number, rejected: number, status: number): Response {
  return Response.json({ accepted, rejected }, { status })
}

function rejectedCount(input: unknown): number {
  if (!Array.isArray(input)) return 1
  return Math.max(1, input.length)
}

function rpcParameters(item: AnalyticsPayload): Record<string, unknown> {
  const parameters: Record<string, unknown> = {
    p_install_hash: item.installHash,
    p_event_type: item.eventType,
    p_day_key: item.dayKey,
    p_weapon_id: item.weaponId,
    p_value: item.value,
  }
  if (item.dimension !== null) parameters.p_dimension = item.dimension
  return parameters
}

export function createIngestHandler(rpcClient: AnalyticsRpcClient) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return counts(0, 1, 405)

    const declaredLength = Number(request.headers.get('content-length') ?? '0')
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      return counts(0, 1, 400)
    }

    let input: unknown
    try {
      const body = await request.text()
      if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) return counts(0, 1, 400)
      input = JSON.parse(body) as unknown
    } catch {
      return counts(0, 1, 400)
    }

    const validated = validateAnalyticsBatch(input)
    if (!validated.ok) return counts(0, rejectedCount(input), 400)

    let accepted = 0
    for (const item of validated.items) {
      let result: RpcResult
      try {
        result = await rpcClient.rpc(
          item.dimension === null ? 'ingest_analytics' : 'ingest_analytics_v2',
          rpcParameters(item)
        )
      } catch {
        return counts(accepted, validated.items.length - accepted, 500)
      }
      if (result.error) {
        if (result.error.code === 'P0001') {
          return counts(accepted, validated.items.length - accepted, 429)
        }
        if (result.error.code === '22023') {
          return counts(accepted, validated.items.length - accepted, 400)
        }
        return counts(accepted, validated.items.length - accepted, 500)
      }
      accepted += 1
    }
    return counts(accepted, 0, 200)
  }
}
