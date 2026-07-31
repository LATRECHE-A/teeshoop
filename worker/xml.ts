/**
 * XML — a dependency-free reader, just big enough for the Falk&Ross feeds.
 *
 * Cloudflare Workers have no `DOMParser` and pulling an XML library in for a
 * handful of feeds would be the tail wagging the dog: the F&R payloads are
 * machine-generated, attribute-free, and we only ever ask them for the text of
 * a named element. So this module offers exactly that — find an element, read
 * its text, iterate repeated children — and nothing else.
 *
 * It is NOT a general XML parser and does not pretend to be one:
 *  - no attribute access (the F&R feeds carry none), no namespaces;
 *  - no validation — a malformed document yields nulls, never an exception.
 *
 * What it DOES get right, because the real payloads contain all three:
 *  - `<![CDATA[…]]>` sections, whose contents are literal: a `<style_name>`
 *    inside CDATA must not be mistaken for markup, and `&amp;` inside CDATA is
 *    an ampersand followed by "amp;", not an entity;
 *  - NESTED elements of the same name — `<style_category_main>` contains
 *    `<style_category_sub>` contains `<language>`; a non-greedy regex would
 *    close the outer element on the inner element's tag. `findElement` counts
 *    depth instead;
 *  - self-closing tags (`<p_err />`), which appear all over the order schema.
 *
 * Everything is index-based on one immutable string, so reading a 770 KB style
 * list costs no intermediate allocation beyond the slices actually asked for.
 */

/** A located element: `inner` is the raw (still-encoded) content. */
export interface XmlElement {
  /** Raw inner markup — pass through `decodeXml` for text. */
  inner: string
  /** Index just past this element's closing `>` — resume scanning here. */
  after: number
}

const NAME_CHARS = /[A-Za-z0-9_:.\-]/

/**
 * If `i` points at a construct whose contents are NOT markup (CDATA, comment,
 * processing instruction, doctype), return the index just past it. Else null.
 *
 * This is what keeps a `<` inside CDATA from being read as a tag.
 */
function skipNonMarkup(xml: string, i: number): number | null {
  if (xml.startsWith('<![CDATA[', i)) {
    const e = xml.indexOf(']]>', i + 9)
    return e < 0 ? xml.length : e + 3
  }
  if (xml.startsWith('<!--', i)) {
    const e = xml.indexOf('-->', i + 4)
    return e < 0 ? xml.length : e + 3
  }
  if (xml.startsWith('<?', i)) {
    const e = xml.indexOf('?>', i + 2)
    return e < 0 ? xml.length : e + 2
  }
  if (xml.startsWith('<!', i)) {
    const e = xml.indexOf('>', i + 2)
    return e < 0 ? xml.length : e + 1
  }
  return null
}

interface Tag {
  name: string
  closing: boolean
  selfClosing: boolean
  /** Index just past the `>`. */
  end: number
}

/** Read the tag starting at `i` (which must point at `<`). */
function readTag(xml: string, i: number): Tag | null {
  let j = i + 1
  const closing = xml[j] === '/'
  if (closing) j++
  const nameStart = j
  while (j < xml.length && NAME_CHARS.test(xml[j])) j++
  if (j === nameStart) return null
  const name = xml.slice(nameStart, j)
  // Walk to the '>' honouring quoted attribute values. The F&R feeds have no
  // attributes, but a stray quoted '>' must not truncate a tag if one appears.
  let quote = ''
  while (j < xml.length) {
    const c = xml[j]
    if (quote) {
      if (c === quote) quote = ''
    } else if (c === '"' || c === "'") {
      quote = c
    } else if (c === '>') {
      return { name, closing, selfClosing: xml[j - 1] === '/', end: j + 1 }
    }
    j++
  }
  return null
}

/**
 * Find the first `<name>…</name>` at or after `from`, counting depth so a
 * nested element of the same name cannot close the outer one.
 *
 * Returns null when the element is absent or never closed.
 */
export function findElement(xml: string, name: string, from = 0): XmlElement | null {
  let i = from
  for (;;) {
    i = xml.indexOf('<', i)
    if (i < 0) return null
    const skipped = skipNonMarkup(xml, i)
    if (skipped !== null) {
      i = skipped
      continue
    }
    const tag = readTag(xml, i)
    if (!tag) {
      i++
      continue
    }
    if (tag.closing || tag.name !== name) {
      i = tag.end
      continue
    }
    if (tag.selfClosing) return { inner: '', after: tag.end }

    let depth = 1
    let k = tag.end
    for (;;) {
      const p = xml.indexOf('<', k)
      if (p < 0) return null
      const inner = skipNonMarkup(xml, p)
      if (inner !== null) {
        k = inner
        continue
      }
      const t = readTag(xml, p)
      if (!t) {
        k = p + 1
        continue
      }
      if (t.name === name) {
        if (t.closing) {
          depth--
          if (depth === 0) return { inner: xml.slice(tag.end, p), after: t.end }
        } else if (!t.selfClosing) {
          depth++
        }
      }
      k = t.end
    }
  }
}

/** Raw inner markup of the first `<name>`, or null when absent. */
export function elementInner(xml: string, name: string, from = 0): string | null {
  return findElement(xml, name, from)?.inner ?? null
}

/**
 * Decoded text of the first `<name>`. Returns '' for an absent OR empty
 * element — the feeds use `<style_catalog_page></style_catalog_page>` for "no
 * value", so the two cases are genuinely the same thing here.
 */
export function elementText(xml: string, name: string, from = 0): string {
  const el = findElement(xml, name, from)
  return el ? decodeXml(el.inner) : ''
}

/** Raw inner markup of every `<name>`, in document order. */
export function allElements(xml: string, name: string, limit = Infinity): string[] {
  const out: string[] = []
  let from = 0
  while (out.length < limit) {
    const el = findElement(xml, name, from)
    if (!el) break
    out.push(el.inner)
    from = el.after
  }
  return out
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10)
      // Reject non-characters rather than emitting U+FFFD noise.
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : m
    }
    return ENTITIES[body] ?? m
  })
}

/**
 * Raw inner markup → this element's OWN text.
 *
 * Two rules, both of which the real feeds depend on:
 *  - CDATA contributes its contents VERBATIM. It is literal by definition, so
 *    `<![CDATA[A&amp;B]]>` is the eight characters "A&amp;B", and a `<b>` in
 *    there is text, not a tag. Everything outside CDATA is entity-decoded.
 *  - CHILD ELEMENTS ARE SKIPPED WHOLE, descendants included. This matters for
 *    mixed content: `<style_category_main>` holds the text "Products" beside
 *    its `<style_category_sub>` children, and folding the children's text in
 *    would turn a category name into a paragraph of every translation.
 *
 * Ends are trimmed (the feeds pretty-print CDATA onto its own line); interior
 * newlines are kept, because the description texts are bullet lists.
 */
export function decodeXml(raw: string): string {
  let out = ''
  let i = 0
  while (i < raw.length) {
    const lt = raw.indexOf('<', i)
    if (lt < 0) {
      out += decodeEntities(raw.slice(i))
      break
    }
    out += decodeEntities(raw.slice(i, lt))

    if (raw.startsWith('<![CDATA[', lt)) {
      const close = raw.indexOf(']]>', lt + 9)
      if (close < 0) {
        out += raw.slice(lt + 9)
        break
      }
      out += raw.slice(lt + 9, close)
      i = close + 3
      continue
    }
    // Comments / PIs / doctype contribute nothing.
    const skipped = skipNonMarkup(raw, lt)
    if (skipped !== null) {
      i = skipped
      continue
    }
    const tag = readTag(raw, lt)
    if (!tag) {
      i = lt + 1
      continue
    }
    if (tag.closing || tag.selfClosing) {
      i = tag.end
      continue
    }
    // A child element: jump past the whole subtree. findElement re-locates
    // this very tag (it scans from `lt`), so `.after` is its closing `>`.
    const child = findElement(raw, tag.name, lt)
    i = child ? child.after : tag.end
  }
  return out.trim()
}

/**
 * Pick a translation out of a per-language block.
 *
 * The feeds use two shapes for the same idea — `<style_name><language><fr>…`
 * for texts, and `<style_sleeve_group><fr>…` (no wrapper) for filter groups —
 * so the `<language>` wrapper is unwrapped when present and ignored when not.
 *
 * @param prefer ISO-2 codes in falling preference, e.g. ['fr','en','de'].
 */
export function langText(inner: string | null, prefer: readonly string[]): string {
  if (!inner) return ''
  const base = elementInner(inner, 'language') ?? inner
  for (const code of prefer) {
    const v = elementText(base, code)
    if (v) return v
  }
  return ''
}
