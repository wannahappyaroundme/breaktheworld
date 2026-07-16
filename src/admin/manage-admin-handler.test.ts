import { describe, expect, it, vi } from 'vitest'

import { createManageAdminHandler, type ManageAdminDependencies } from '../../supabase/functions/_shared/manage-admin-handler.ts'

function dependency(options: {
  caller?: { id: string } | null
  role?: 'owner' | 'operator'
  active?: boolean
  target?: { user_id: string; role: 'owner' | 'operator'; active: boolean } | null
  authFailureFor?: string
} = {}) {
  const calls: string[] = []
  const caller = options.caller === null ? null : options.caller ?? { id: 'caller' }
  const adminRows = options.target === undefined
    ? [{ user_id: 'target', role: 'operator', active: true }]
    : options.target === null ? [] : [options.target]
  const userClient = {
    auth: { getUser: vi.fn(async () => ({ data: { user: caller }, error: caller ? null : { message: 'none' } })) },
    from(table: string) {
      calls.push(`user:from:${table}`)
      const result = { data: caller ? { user_id: caller.id, role: options.role ?? 'owner', active: options.active ?? true } : null, error: null }
      const query = {
        select(columns: string) { calls.push(`user:select:${columns}`); return query },
        eq(column: string, value: string) { calls.push(`user:eq:${column}:${value}`); return query },
        maybeSingle: async () => result,
      }
      return query
    },
  }
  const adminClient = {
    from(table: string) {
      calls.push(`admin:from:${table}`)
      const query = {
        select(columns: string) { calls.push(`admin:select:${columns}`); return query },
        eq(column: string, value: string) { calls.push(`admin:eq:${column}:${value}`); return query },
        update(value: unknown) {
          calls.push(`admin:update:${JSON.stringify(value)}`)
          if (adminRows[0] && value && typeof value === 'object'
            && typeof (value as { active?: unknown }).active === 'boolean') {
            adminRows[0].active = (value as { active: boolean }).active
          }
          return query
        },
        maybeSingle: async () => ({ data: adminRows[0] ?? null, error: null }),
        then(resolve: (result: unknown) => void) { resolve({ data: adminRows, error: null }) },
      }
      return query
    },
    auth: { admin: {
      getUserById: vi.fn(async (id: string) => (
        id === options.authFailureFor
          ? { data: { user: null }, error: { message: 'auth unavailable' } }
          : { data: { user: { id, email: `${id}@example.test`, app_metadata: { secret: 'not-returned' } } }, error: null }
      )),
    } },
  }
  const getAdminClient = vi.fn(() => adminClient)
  return { dependencies: { userClient, getAdminClient } as unknown as ManageAdminDependencies, calls, getAdminClient, adminRows }
}

async function body(response: Response) {
  return response.json() as Promise<Record<string, unknown>>
}

describe('manage-admin handler', () => {
  it('keeps email signup closed and JWT verification enabled in local function config', async () => {
    const { readFileSync } = await vi.importActual<{
      readFileSync(path: URL, encoding: 'utf8'): string
    }>('node:fs')
    const config = readFileSync(new URL('../../supabase/config.toml', import.meta.url), 'utf8')
    const emailSection = config.split('[auth.email]')[1]?.split(/^\[/m)[0] ?? ''
    const functionSection = config.split('[functions.manage-admin]')[1]?.split(/^\[/m)[0] ?? ''

    expect(emailSection).toMatch(/^enable_signup = false$/m)
    expect(functionSection).toMatch(/^verify_jwt = true$/m)
  })

  it.each([
    ['missing caller', { caller: null }],
    ['operator', { role: 'operator' as const }],
    ['inactive owner', { active: false }],
  ])('denies %s before creating or using the privileged client', async (_label, options) => {
    const { dependencies, getAdminClient, calls } = dependency(options)
    const response = await createManageAdminHandler(dependencies)(new Request('http://local', {
      method: 'POST', body: JSON.stringify({ action: 'list' }),
    }))

    expect(response.status).toBe('caller' in options && options.caller === null ? 401 : 403)
    expect(getAdminClient).not.toHaveBeenCalled()
    expect(calls.some((call) => call.startsWith('admin:'))).toBe(false)
  })

  it('lists only id, email, role and active after owner verification', async () => {
    const { dependencies, calls } = dependency()
    const response = await createManageAdminHandler(dependencies)(new Request('http://local', {
      method: 'POST', body: JSON.stringify({ action: 'list' }),
    }))

    expect(response.status).toBe(200)
    const payload = await body(response)
    expect(payload).toEqual({ admins: [{ id: 'target', email: 'target@example.test', role: 'operator', active: true }] })
    expect(calls).toContain('user:select:user_id,role,active')
    expect(calls).toContain('admin:select:user_id,role,active')
    expect(JSON.stringify(payload)).not.toContain('secret')
  })

  it('returns a safe failure instead of an incomplete list when Auth lookup fails', async () => {
    const { dependencies } = dependency({ authFailureFor: 'target' })
    const response = await createManageAdminHandler(dependencies)(new Request('http://local', {
      method: 'POST', body: JSON.stringify({ action: 'list' }),
    }))

    expect(response.status).toBe(500)
    expect(await body(response)).toEqual({ message: 'request_unavailable' })
  })

  it.each([
    ['unknown action', { action: 'create' }],
    ['extra list key', { action: 'list', role: 'owner' }],
    ['extra mutation key', { action: 'set-active', userId: 'target', active: false, role: 'owner' }],
    ['missing boolean', { action: 'set-active', userId: 'target', active: 'false' }],
  ])('rejects malformed input: %s', async (_label, requestBody) => {
    const { dependencies } = dependency()
    const response = await createManageAdminHandler(dependencies)(new Request('http://local', {
      method: 'POST', body: JSON.stringify(requestBody),
    }))
    expect(response.status).toBe(400)
  })

  it('rejects self-disable before any update', async () => {
    const { dependencies, calls } = dependency()
    const response = await createManageAdminHandler(dependencies)(new Request('http://local', {
      method: 'POST', body: JSON.stringify({ action: 'set-active', userId: 'caller', active: false }),
    }))
    expect(response.status).toBe(409)
    expect(calls.some((call) => call.startsWith('admin:update'))).toBe(false)
  })

  it('updates only active for an existing target and returns the limited record', async () => {
    const { dependencies, calls } = dependency()
    const response = await createManageAdminHandler(dependencies)(new Request('http://local', {
      method: 'POST', body: JSON.stringify({ action: 'set-active', userId: 'target', active: false }),
    }))
    expect(response.status).toBe(200)
    expect(calls).toContain('admin:update:{"active":false}')
    expect(await body(response)).toEqual({ admin: { id: 'target', email: 'target@example.test', role: 'operator', active: false } })
  })

  it('checks the Auth user before update and leaves active unchanged when lookup fails', async () => {
    const { dependencies, calls, adminRows } = dependency({ authFailureFor: 'target' })
    const response = await createManageAdminHandler(dependencies)(new Request('http://local', {
      method: 'POST', body: JSON.stringify({ action: 'set-active', userId: 'target', active: false }),
    }))

    expect(response.status).toBe(500)
    expect(await body(response)).toEqual({ message: 'request_unavailable' })
    expect(calls.some((call) => call.startsWith('admin:update'))).toBe(false)
    expect(adminRows[0]?.active).toBe(true)
  })

  it('returns not found without creating an account', async () => {
    const { dependencies, calls } = dependency({ target: null })
    const response = await createManageAdminHandler(dependencies)(new Request('http://local', {
      method: 'POST', body: JSON.stringify({ action: 'set-active', userId: 'target', active: true }),
    }))
    expect(response.status).toBe(404)
    expect(calls.some((call) => call.includes('insert'))).toBe(false)
  })
})
