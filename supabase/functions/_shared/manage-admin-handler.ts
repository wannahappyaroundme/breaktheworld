export interface ManageAdminUserClient {
  auth: {
    getUser(): Promise<{
      data: { user: { id: string } | null }
      error: unknown
    }>
  }
  from(table: string): unknown
}

export interface ManageAdminPrivilegedClient {
  auth: {
    admin: {
      getUserById(id: string): Promise<{
        data: { user: { id: string; email?: string | null } | null }
        error: unknown
      }>
    }
  }
  from(table: string): unknown
}

export interface ManageAdminDependencies {
  userClient: ManageAdminUserClient
  getAdminClient(): ManageAdminPrivilegedClient
}

interface AdminRow {
  user_id: string
  role: 'owner' | 'operator'
  active: boolean
}

interface QueryResult<T> {
  data: T
  error: unknown
}

interface OwnerQuery {
  select(columns: string): OwnerQuery
  eq(column: string, value: string): OwnerQuery
  maybeSingle(): Promise<QueryResult<AdminRow | null>>
}

interface AdminQuery {
  select(columns: string): AdminQuery
  eq(column: string, value: string): AdminQuery
  update(value: { active: boolean }): AdminQuery
  maybeSingle(): Promise<QueryResult<AdminRow | null>>
  then<TResult1 = QueryResult<AdminRow[]>, TResult2 = never>(
    onfulfilled?: ((value: QueryResult<AdminRow[]>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2>
}

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
}

function json(status: number, value: object): Response {
  return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS })
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort()
  const wanted = [...expected].sort()
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index])
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

async function requestBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed = await request.json()
    return isObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

function adminShape(row: AdminRow, email: string) {
  return { id: row.user_id, email, role: row.role, active: row.active }
}

export function createManageAdminHandler(dependencies: ManageAdminDependencies) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return json(405, { message: 'method_not_allowed' })

    const callerResult = await dependencies.userClient.auth.getUser()
    const caller = callerResult.data.user
    if (callerResult.error || !caller) return json(401, { message: 'authentication_required' })

    const ownerResult = await (dependencies.userClient.from('admin_users') as OwnerQuery)
      .select('user_id,role,active')
      .eq('user_id', caller.id)
      .maybeSingle()
    const owner = ownerResult.data
    if (ownerResult.error || !owner || owner.user_id !== caller.id || owner.role !== 'owner' || !owner.active) {
      return json(403, { message: 'owner_required' })
    }

    const input = await requestBody(request)
    if (!input || typeof input.action !== 'string') return json(400, { message: 'invalid_request' })

    if (input.action === 'list') {
      if (!exactKeys(input, ['action'])) return json(400, { message: 'invalid_request' })
      const adminClient = dependencies.getAdminClient()
      const rowsResult = await (adminClient.from('admin_users') as AdminQuery)
        .select('user_id,role,active')
      if (rowsResult.error || !Array.isArray(rowsResult.data)) return json(500, { message: 'request_unavailable' })

      const admins = []
      for (const row of rowsResult.data) {
        if (!row || !['owner', 'operator'].includes(row.role) || typeof row.active !== 'boolean') continue
        const userResult = await adminClient.auth.admin.getUserById(row.user_id)
        const user = userResult.data.user
        if (userResult.error || !user || user.id !== row.user_id || typeof user.email !== 'string') {
          return json(500, { message: 'request_unavailable' })
        }
        admins.push(adminShape(row, user.email))
      }
      admins.sort((left, right) => left.email.localeCompare(right.email))
      return json(200, { admins })
    }

    if (input.action === 'set-active') {
      if (!exactKeys(input, ['action', 'userId', 'active'])
        || typeof input.userId !== 'string' || input.userId.length < 1 || input.userId.length > 128
        || typeof input.active !== 'boolean') {
        return json(400, { message: 'invalid_request' })
      }
      if (input.userId === caller.id && input.active === false) {
        return json(409, { message: 'self_disable_rejected' })
      }

      const adminClient = dependencies.getAdminClient()
      const targetResult = await (adminClient.from('admin_users') as AdminQuery)
        .select('user_id,role,active')
        .eq('user_id', input.userId)
        .maybeSingle()
      const target = targetResult.data
      if (targetResult.error) return json(500, { message: 'request_unavailable' })
      if (!target) return json(404, { message: 'account_not_found' })

      const userResult = await adminClient.auth.admin.getUserById(target.user_id)
      const user = userResult.data.user
      if (userResult.error || !user || user.id !== target.user_id || typeof user.email !== 'string') {
        return json(500, { message: 'request_unavailable' })
      }

      const updateResult = await (adminClient.from('admin_users') as AdminQuery)
        .update({ active: input.active })
        .eq('user_id', input.userId)
      if (updateResult.error) return json(500, { message: 'request_unavailable' })

      return json(200, { admin: adminShape({ ...target, active: input.active }, user.email) })
    }

    return json(400, { message: 'invalid_request' })
  }
}
