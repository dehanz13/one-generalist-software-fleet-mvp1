import { describe, expect, it } from 'vitest'
import { fleetApiBase, linkedChoice } from './source'

describe('fleetApiBase', () => {
  it('appends /api once and drops a trailing slash', () => {
    expect(fleetApiBase('http://127.0.0.1:4600')).toBe('http://127.0.0.1:4600/api')
    expect(fleetApiBase('http://127.0.0.1:4600/')).toBe('http://127.0.0.1:4600/api')
    expect(fleetApiBase('https://fleet.example.com/api/')).toBe('https://fleet.example.com/api')
  })

  it('refuses anything that is not http(s)', () => {
    expect(fleetApiBase('javascript:alert(1)')).toBeNull()
    expect(fleetApiBase('file:///etc/passwd')).toBeNull()
    expect(fleetApiBase('not a url')).toBeNull()
  })
})

describe('linkedChoice', () => {
  it('opens the demo from a shared link and leaves other links alone', () => {
    expect(linkedChoice('?demo')).toEqual({ kind: 'demo' })
    expect(linkedChoice('?source=demo')).toEqual({ kind: 'demo' })
    expect(linkedChoice('')).toBeNull()
    expect(linkedChoice('?source=here')).toBeNull()
  })
})
