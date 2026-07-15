import assert from 'node:assert/strict'
import test from 'node:test'

import { findForbiddenHits, isScannablePath } from './copy-lint.mjs'

test('finds forbidden rendered copy in TypeScript strings and templates', () => {
  const source = [
    'const title = "세상 부수기 — 오늘도 통쾌하게"',
    'const helper = `OCR 대신 자동 인식으로 불러요`',
    'const board = "Kanban 화면"',
    'const badge = "심의 완료"',
    'const audience = "새 리드를 확인해요"',
  ].join('\n')

  assert.deepEqual(
    findForbiddenHits('src/example.ts', source).map(({ line, term }) => ({ line, term })),
    [
      { line: 1, term: '—' },
      { line: 2, term: 'OCR' },
      { line: 3, term: 'Kanban' },
      { line: 4, term: '심의 완료' },
      { line: 5, term: '리드' },
    ],
  )
})

test('ignores comments and internal enum member identifiers', () => {
  const source = [
    '// "OCR — 리드" is internal documentation',
    '/* `Kanban` and "심의 완료" are test notes. */',
    'enum ParserMode {',
    '  OCR = "OCR",',
    '  RECOGNIZER = "OCR",',
    '}',
    'type ParserAlias = "OCR2" | "KanbanBoard"',
    'switch (mode) { case "OCR2": break }',
    'const interpolated = `자동 ${/* OCR — Kanban */ mode} 인식`',
    'const layout = "그리드"',
    'const title = "자동 인식"',
  ].join('\n')

  assert.deepEqual(findForbiddenHits('src/example.ts', source), [])
})

test('scans rendered template chunks on both sides of an interpolation', () => {
  const source = 'const helper = `자동 ${mode} Kanban 보기`'

  assert.deepEqual(findForbiddenHits('src/example.ts', source), [
    { file: 'src/example.ts', line: 1, term: 'Kanban' },
  ])
})

test('finds encoded em dashes that render in TypeScript and HTML copy', () => {
  assert.deepEqual(findForbiddenHits('src/example.ts', 'const title = "좋은 \\u2014 문구"'), [
    { file: 'src/example.ts', line: 1, term: '—' },
  ])
  assert.deepEqual(findForbiddenHits('index.html', '<meta content="좋은 &mdash; 문구">'), [
    { file: 'index.html', line: 1, term: '—' },
  ])
  assert.deepEqual(findForbiddenHits('index.html', '<meta content="좋은 &#8212; 문구">'), [
    { file: 'index.html', line: 1, term: '—' },
  ])
  assert.deepEqual(findForbiddenHits('src/example.ts', 'const audience = "\\uB9AC\\uB4DC를 확인해요"'), [
    { file: 'src/example.ts', line: 1, term: '리드' },
  ])
})

test('finds forbidden terms when rendered copy adds an ASCII suffix', () => {
  const source = ['const mode = "OCR2"', 'const board = "KanbanBoard 보기"'].join('\n')

  assert.deepEqual(findForbiddenHits('src/example.ts', source), [
    { file: 'src/example.ts', line: 1, term: 'OCR' },
    { file: 'src/example.ts', line: 2, term: 'Kanban' },
  ])
})

test('finds uppercase hexadecimal HTML numeric entities', () => {
  assert.deepEqual(findForbiddenHits('index.html', '<meta content="좋은 &#X2014; 문구">'), [
    { file: 'index.html', line: 1, term: '—' },
  ])
})

test('keeps UTF-16 offsets aligned when an emoji appears before an HTML comment', () => {
  const source = '<meta content="💥"><!-- OCR — 리드 Kanban --><main>자동 인식</main>'

  assert.deepEqual(findForbiddenHits('index.html', source), [])
})

test('reports the right line after an escaped supplementary Unicode character', () => {
  const source = 'const copy = `\\u{1F4A5}\n—`'

  assert.deepEqual(findForbiddenHits('src/example.ts', source), [
    { file: 'src/example.ts', line: 2, term: '—' },
  ])
})

test('finds forbidden copy in HTML attributes and visible text', () => {
  const source = [
    '<!-- OCR — ignored -->',
    '<meta name="description" content="새 리드 — 빠르게 확인">',
    '<main>Kanban 대신 단계별로 확인</main>',
  ].join('\n')

  assert.deepEqual(
    findForbiddenHits('index.html', source).map(({ line, term }) => ({ line, term })),
    [
      { line: 2, term: '—' },
      { line: 2, term: '리드' },
      { line: 3, term: 'Kanban' },
    ],
  )
})

test('limits the production scan to index.html and non-test TypeScript sources', () => {
  assert.equal(isScannablePath('index.html'), true)
  assert.equal(isScannablePath('src/ui/hud.ts'), true)
  assert.equal(isScannablePath('src/ui/hud.test.ts'), false)
  assert.equal(isScannablePath('src/__tests__/fixture.ts'), false)
  assert.equal(isScannablePath('src/fixtures/copy.ts'), false)
  assert.equal(isScannablePath('scripts/copy-lint.mjs'), false)
  assert.equal(isScannablePath('src/style.css'), false)
})
