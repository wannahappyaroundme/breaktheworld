import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const FORBIDDEN_TERMS = ['—', 'OCR', '리드', 'Kanban', '심의 완료']

function lineAt(source, index) {
  let line = 1
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (source[cursor] === '\n') line += 1
  }
  return line
}

function blankHtmlComments(source) {
  const chars = source.split('')
  let searchFrom = 0
  while (searchFrom < source.length) {
    const start = source.indexOf('<!--', searchFrom)
    if (start === -1) break
    const end = source.indexOf('-->', start + 4)
    const stop = end === -1 ? chars.length : end + 3
    for (let cursor = start; cursor < stop; cursor += 1) {
      if (chars[cursor] !== '\n') chars[cursor] = ' '
    }
    searchFrom = stop
  }

  return chars.join('')
}

function extractTypeScriptCandidates(file, source) {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const candidates = []

  function isInternalIdentifier(node) {
    const parent = node.parent
    return (
      (ts.isEnumMember(parent) && parent.initializer === node) ||
      ts.isLiteralTypeNode(parent) ||
      (ts.isCaseClause(parent) && parent.expression === node) ||
      ((ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent) || ts.isMethodDeclaration(parent)) && parent.name === node) ||
      (ts.isElementAccessExpression(parent) && parent.argumentExpression === node)
    )
  }

  function addCandidate(node, trimStart, trimEnd) {
    const tokenStart = node.getStart(sourceFile)
    const start = tokenStart + trimStart
    const end = node.getEnd() - trimEnd
    candidates.push({
      start,
      value: source.slice(start, end),
      internal: isInternalIdentifier(node),
      mode: 'typescript',
    })
  }

  function visit(node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      addCandidate(node, 1, 1)
    } else if (node.kind === ts.SyntaxKind.TemplateHead || node.kind === ts.SyntaxKind.TemplateMiddle) {
      addCandidate(node, 1, 2)
    } else if (node.kind === ts.SyntaxKind.TemplateTail) {
      addCandidate(node, 1, 1)
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return candidates
}

function extractHtmlCandidates(source) {
  const withoutComments = blankHtmlComments(source)
  const candidates = []

  const quotedAttribute = /(["'])([\s\S]*?)\1/g
  let match
  while ((match = quotedAttribute.exec(withoutComments)) !== null) {
    const valueOffset = match[0].indexOf(match[2])
    candidates.push({
      start: match.index + valueOffset,
      value: match[2],
      internal: false,
      mode: 'html',
    })
  }

  const visibleText = />([^<]+)</g
  while ((match = visibleText.exec(withoutComments)) !== null) {
    const valueOffset = match[0].indexOf(match[1])
    candidates.push({
      start: match.index + valueOffset,
      value: match[1],
      internal: false,
      mode: 'html',
    })
  }

  return candidates.sort((left, right) => left.start - right.start)
}

function decodeCandidate(candidate) {
  const decoded = []
  const offsets = []

  function append(value, offset) {
    decoded.push(value)
    for (let unit = 0; unit < value.length; unit += 1) offsets.push(offset)
  }

  for (let index = 0; index < candidate.value.length; index += 1) {
    const remaining = candidate.value.slice(index)
    let match

    if (candidate.mode === 'typescript' && candidate.value[index] === '\\') {
      match = remaining.match(/^\\u\{([0-9a-fA-F]{1,6})\}/)
      if (match) {
        const codePoint = Number.parseInt(match[1], 16)
        if (codePoint <= 0x10ffff) append(String.fromCodePoint(codePoint), index)
        index += match[0].length - 1
        continue
      }

      match = remaining.match(/^\\u([0-9a-fA-F]{4})/)
      if (match) {
        append(String.fromCharCode(Number.parseInt(match[1], 16)), index)
        index += match[0].length - 1
        continue
      }

      match = remaining.match(/^\\x([0-9a-fA-F]{2})/)
      if (match) {
        append(String.fromCharCode(Number.parseInt(match[1], 16)), index)
        index += match[0].length - 1
        continue
      }

      if (index + 1 < candidate.value.length) {
        append(candidate.value[index + 1], index)
        index += 1
        continue
      }
    }

    if (candidate.mode === 'html' && candidate.value[index] === '&') {
      match = remaining.match(/^&#(\d+);/)
      if (!match) match = remaining.match(/^&#[xX]([0-9a-fA-F]+);/)
      if (match) {
        const radix = /^&#[xX]/.test(match[0]) ? 16 : 10
        const codePoint = Number.parseInt(match[1], radix)
        if (codePoint <= 0x10ffff) append(String.fromCodePoint(codePoint), index)
        index += match[0].length - 1
        continue
      }
      if (remaining.startsWith('&mdash;')) {
        append('—', index)
        index += '&mdash;'.length - 1
        continue
      }
    }

    append(candidate.value[index], index)
  }

  return { value: decoded.join(''), offsets }
}

function hasTermBoundary(value, offset, term) {
  const before = value[offset - 1] ?? ''
  if (term === '리드') return !/[가-힣]/.test(before)
  return true
}

export function findForbiddenHits(file, source) {
  const candidates = file.endsWith('.html') ? extractHtmlCandidates(source) : extractTypeScriptCandidates(file, source)
  const hits = []

  for (const candidate of candidates) {
    if (candidate.internal) continue
    const rendered = decodeCandidate(candidate)

    for (const term of FORBIDDEN_TERMS) {
      let offset = rendered.value.indexOf(term)
      while (offset !== -1) {
        if (hasTermBoundary(rendered.value, offset, term)) {
          hits.push({ file, line: lineAt(source, candidate.start + rendered.offsets[offset]), term })
        }
        offset = rendered.value.indexOf(term, offset + term.length)
      }
    }
  }

  return hits.sort((left, right) => left.line - right.line || FORBIDDEN_TERMS.indexOf(left.term) - FORBIDDEN_TERMS.indexOf(right.term))
}

export function isScannablePath(file) {
  const normalized = file.replaceAll('\\', '/')
  if (!normalized.includes('/') && normalized.endsWith('.html')) return true
  if (!normalized.startsWith('src/') || !normalized.endsWith('.ts')) return false
  if (/\.(test|spec)\.ts$/.test(normalized)) return false
  if (/\/(?:__tests__|fixtures?)\//.test(normalized)) return false
  return true
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await walk(absolute)))
    else files.push(absolute)
  }
  return files
}

async function main() {
  const root = process.cwd()
  const rootHtmlFiles = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && isScannablePath(entry.name))
    .map((entry) => path.join(root, entry.name))
  const absoluteFiles = [...rootHtmlFiles, ...(await walk(path.join(root, 'src')))]
  const files = absoluteFiles
    .map((absolute) => ({ absolute, relative: path.relative(root, absolute).replaceAll('\\', '/') }))
    .filter(({ relative }) => isScannablePath(relative))
    .sort((left, right) => left.relative.localeCompare(right.relative))
  const hits = []

  for (const file of files) {
    const source = await readFile(file.absolute, 'utf8')
    hits.push(...findForbiddenHits(file.relative, source))
  }

  if (hits.length > 0) {
    process.stderr.write(`${hits.map((hit) => `${hit.file}:${hit.line} ${hit.term}`).join('\n')}\n`)
    process.exitCode = 1
    return
  }

  process.stdout.write(`Copy lint passed (${files.length} files).\n`)
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ''
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
