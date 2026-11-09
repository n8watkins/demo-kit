// Read Aloud Test: demo-kit's stand-in for a read-aloud extension.
// Select text and a "Read aloud" chip appears under the selection; press it and
// a player bar slides up while the selected words light up one at a time.
// Nothing is spoken: the pace is a steady 200 words a minute.
;(() => {
  const PLAY = '<svg viewBox="0 0 12 12"><path d="M2 1l9 5-9 5z"/></svg>'
  const PAUSE = '<svg viewBox="0 0 12 12"><path d="M2 1h3v10H2zM7 1h3v10H7z"/></svg>'
  const WORD_MS = 300

  const chip = document.createElement('button')
  chip.className = 'ra-chip'
  chip.type = 'button'
  chip.innerHTML = `${PLAY}<span>Read aloud</span>`
  document.body.append(chip)

  const bar = document.createElement('div')
  bar.className = 'ra-bar'
  bar.setAttribute('role', 'region')
  bar.setAttribute('aria-label', 'Read Aloud player')
  bar.innerHTML = `
    <button type="button" class="ra-pp" aria-label="Pause">${PAUSE}</button>
    <div>
      <div><span class="ra-title">Reading selection</span> <span class="ra-voice">- Ava, local voice</span></div>
      <div class="ra-track"><div class="ra-fill"></div></div>
    </div>
    <span class="ra-time">0:00</span>`
  document.body.append(bar)
  const pp = bar.querySelector('.ra-pp')
  const fill = bar.querySelector('.ra-fill')
  const time = bar.querySelector('.ra-time')

  let range = null
  let words = []
  let index = 0
  let timer = 0

  document.addEventListener('mouseup', () => {
    setTimeout(() => {
      const sel = getSelection()
      if (!sel || sel.isCollapsed || !sel.toString().trim()) return hideChip()
      range = sel.getRangeAt(0).cloneRange()
      // Centred above the selection, like a selection toolbar.
      const box = range.getBoundingClientRect()
      chip.style.left = `${Math.round(box.left + box.width / 2 - chip.offsetWidth / 2 + scrollX)}px`
      chip.style.top = `${Math.round(box.top - 32 - 10 + scrollY)}px`
      requestAnimationFrame(() => chip.classList.add('is-on'))
    }, 10)
  })
  document.addEventListener('mousedown', (e) => {
    if (e.target instanceof Node && (chip.contains(e.target) || bar.contains(e.target))) return
    hideChip()
  })
  function hideChip() {
    chip.classList.remove('is-on')
  }

  chip.addEventListener('click', () => {
    if (!range) return
    hideChip()
    words = wrapWords(range)
    getSelection()?.removeAllRanges()
    index = 0
    requestAnimationFrame(() => bar.classList.add('is-on'))
    play()
  })
  pp.addEventListener('click', () => (timer ? pause() : play()))

  function play() {
    pp.innerHTML = PAUSE
    pp.setAttribute('aria-label', 'Pause')
    step()
    timer = setInterval(step, WORD_MS)
  }
  function pause() {
    clearInterval(timer)
    timer = 0
    pp.innerHTML = PLAY
    pp.setAttribute('aria-label', 'Play')
  }
  function step() {
    if (index > 0) {
      words[index - 1].classList.remove('ra-current')
      words[index - 1].classList.add('ra-done')
    }
    if (index >= words.length) {
      pause()
      // Done: the bar slides away a moment later.
      setTimeout(() => bar.classList.remove('is-on'), 900)
      return
    }
    words[index].classList.add('ra-current')
    index++
    fill.style.width = `${(100 * index) / words.length}%`
    const s = Math.round((index * WORD_MS) / 1000)
    time.textContent = `0:${String(s).padStart(2, '0')}`
  }

  /** Wraps each word of the range's text in a span, splitting text nodes in place. */
  function wrapWords(r) {
    const root = r.commonAncestorContainer.nodeType === 1 ? r.commonAncestorContainer : r.commonAncestorContainer.parentNode
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const nodes = []
    while (walker.nextNode()) if (r.intersectsNode(walker.currentNode)) nodes.push(walker.currentNode)
    const out = []
    for (const node of nodes) {
      const start = node === r.startContainer ? r.startOffset : 0
      const end = node === r.endContainer ? r.endOffset : node.data.length
      const text = node.data.slice(start, end)
      const frag = document.createDocumentFragment()
      for (const part of text.split(/(\s+)/)) {
        if (!part) continue
        if (/^\s+$/.test(part)) frag.append(part)
        else {
          const span = document.createElement('span')
          span.className = 'ra-w'
          span.textContent = part
          frag.append(span)
          out.push(span)
        }
      }
      const tail = node.splitText(start)
      tail.splitText(end - start)
      tail.replaceWith(frag)
    }
    return out
  }
})()
