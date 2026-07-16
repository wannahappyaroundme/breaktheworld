import { describe, expect, it } from 'vitest'

import viteConfig from '../../vite.config'

function resolveBase(command: 'build' | 'serve', isPreview: boolean): string | undefined {
  if (typeof viteConfig !== 'function') throw new Error('Vite config factory is missing')
  const config = viteConfig({ command, mode: 'production', isPreview })
  if (config instanceof Promise) throw new Error('Vite config must resolve synchronously')
  return config.base
}

describe('Vite base path', () => {
  it('serves the production base during preview while keeping local development at root', () => {
    expect(resolveBase('serve', true)).toBe('/breaktheworld/')
    expect(resolveBase('serve', false)).toBe('/')
  })
})
