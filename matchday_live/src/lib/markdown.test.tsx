import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { JsonBlock } from './json'
import { Markdown } from './markdown'

describe('Markdown (team talks)', () => {
  it('renders headings, lists, code and bold', () => {
    const html = renderToStaticMarkup(<Markdown source={'# Playmaker\n\n- one **two**\n- `three`\n\n```json\n{"a": 1}\n```'} />)
    expect(html).toContain('<h3>Playmaker</h3>')
    expect(html).toContain('<li>one <strong>two</strong></li>')
    expect(html).toContain('<code>three</code>')
    expect(html).toContain('<span class="j-key">&quot;a&quot;</span>')
  })

  it('never turns prompt text into markup', () => {
    const html = renderToStaticMarkup(<Markdown source={'<img src=x onerror="alert(1)"> and <script>x()</script>'} />)
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<script')
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;')
  })

  it('keeps only http(s) links', () => {
    const html = renderToStaticMarkup(<Markdown source={'[ok](https://example.com) [bad](javascript:alert(1))'} />)
    expect(html).toContain('href="https://example.com"')
    expect(html).toContain('rel="noopener noreferrer"')
    // Anything else stays visible as plain text, never an address.
    expect(html).not.toContain('href="javascript')
    expect(html).toContain('[bad](javascript:alert(1))')
  })
})

describe('JsonBlock', () => {
  it('escapes payload text and shows non-JSON as it came', () => {
    expect(renderToStaticMarkup(<JsonBlock raw={'{"x":"<b>"}'} />)).toContain('&lt;b&gt;')
    expect(renderToStaticMarkup(<JsonBlock raw={'not json <i>'} />)).toBe('<pre class="code json">not json &lt;i&gt;</pre>')
  })
})
