// Page helpers a storyboard may need.

import type { Page } from 'playwright'
import type { Box } from '../types.ts'

/**
 * The box (CSS px) of the first element with a class, closed shadow roots
 * included: Playwright's locators cannot enter a closed shadow root, but the
 * DevTools protocol can. The real mouse can then press it by its box.
 */
export async function closedShadowBox(page: Page, className: string): Promise<Box | null> {
  const session = await page.context().newCDPSession(page)
  try {
    type DomNode = { nodeId: number; attributes?: string[]; children?: DomNode[]; shadowRoots?: DomNode[]; contentDocument?: DomNode }
    const { root } = (await session.send('DOM.getDocument', { depth: -1, pierce: true })) as { root: DomNode }
    const stack: DomNode[] = [root]
    while (stack.length) {
      const n = stack.pop() as DomNode
      const attrs = n.attributes ?? []
      const cls = attrs[attrs.indexOf('class') + 1]
      if (attrs.includes('class') && cls?.split(/\s+/).includes(className)) {
        const { model } = (await session.send('DOM.getBoxModel', { nodeId: n.nodeId })) as { model: { border: number[] } }
        const [x1, y1, x2, , , y3] = model.border
        return { x: x1, y: y1, w: x2 - x1, h: y3 - y1 }
      }
      stack.push(...(n.children ?? []), ...(n.shadowRoots ?? []), ...(n.contentDocument ? [n.contentDocument] : []))
    }
    return null
  } finally {
    await session.detach().catch(() => {})
  }
}

/** Polls until `find` returns a value, or throws after `timeout` ms. */
export async function waitFor<T>(find: () => Promise<T | null | undefined>, timeout = 10_000, every = 100): Promise<T> {
  const end = Date.now() + timeout
  for (;;) {
    const v = await find().catch(() => null)
    if (v) return v
    if (Date.now() > end) throw new Error('timed out waiting')
    await new Promise((done) => setTimeout(done, every))
  }
}
