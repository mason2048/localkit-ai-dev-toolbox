import { LineCounter, parseDocument, stringify } from 'yaml'
import type { FormatResult, LocatedError } from './types'

function parseYaml(input: string) {
  const lineCounter = new LineCounter()
  const document = parseDocument(input, { lineCounter, prettyErrors: false, strict: true })
  if (document.errors.length) {
    const first = document.errors[0]
    const position = lineCounter.linePos(first.pos[0])
    const error: LocatedError = {
      code: 'E_YAML_SYNTAX',
      message: `第 ${position.line} 行，第 ${position.col} 列：YAML 语法无效`,
      line: position.line,
      column: position.col,
      suggestion: first.code === 'DUPLICATE_KEY'
        ? '同一层级不能出现重复键；请重命名或删除其中一个。'
        : '请检查此处缩进、冒号后的空格，以及引号或列表标记。',
    }
    throw Object.assign(new Error(error.message), { located: error })
  }
  return document.toJS({ maxAliasCount: 100 }) as unknown
}

export function formatYaml(input: string): FormatResult {
  try {
    const value = parseYaml(input)
    const output = stringify(value, { indent: 2, lineWidth: 0 })
    return { ok: true, output, machine: { ok: true, format: 'yaml', bytes: new Blob([output]).size } }
  } catch (caught) {
    const located = (caught as { located?: LocatedError }).located ?? {
      code: 'E_YAML_SYNTAX', message: '第 1 行，第 1 列：YAML 语法无效', line: 1, column: 1,
      suggestion: '请检查 YAML 缩进和标点。',
    }
    return { ok: false, error: located, machine: { ok: false, error: located } }
  }
}

export function yamlToJson(input: string): FormatResult {
  try {
    const value = parseYaml(input)
    const output = JSON.stringify(value, null, 2)
    return { ok: true, output, machine: { ok: true, from: 'yaml', to: 'json' } }
  } catch (caught) {
    const located = (caught as { located?: LocatedError }).located ?? {
      code: 'E_YAML_SYNTAX', message: '第 1 行，第 1 列：YAML 语法无效', line: 1, column: 1,
      suggestion: '请检查 YAML 缩进和标点。',
    }
    return { ok: false, error: located, machine: { ok: false, error: located } }
  }
}

export function jsonToYaml(input: string): FormatResult {
  const json = (() => {
    try { return { value: JSON.parse(input) as unknown } }
    catch (error) { return { error } }
  })()
  if ('error' in json) {
    const raw = json.error instanceof Error ? json.error.message : 'JSON 语法错误'
    const position = Number(raw.match(/position\s+(\d+)/i)?.[1] ?? 0)
    const before = input.slice(0, position).split('\n')
    const error: LocatedError = {
      code: 'E_JSON_SYNTAX', message: `第 ${before.length} 行，第 ${(before.at(-1)?.length ?? 0) + 1} 列：JSON 语法无效`,
      line: before.length, column: (before.at(-1)?.length ?? 0) + 1, suggestion: '请先修复 JSON 的引号、逗号或括号。',
    }
    return { ok: false, error, machine: { ok: false, error } }
  }
  const output = stringify(json.value, { indent: 2, lineWidth: 0 })
  return { ok: true, output, machine: { ok: true, from: 'json', to: 'yaml' } }
}
