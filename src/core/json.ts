import type { FormatResult, LocatedError } from './types'

function offsetToLocation(input: string, offset: number) {
  const safeOffset = Math.max(0, Math.min(offset, input.length))
  const before = input.slice(0, safeOffset)
  const lines = before.split('\n')
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 }
}

function suggestionFor(message: string) {
  if (/property name|double-quoted/i.test(message)) return '属性名必须使用双引号；请检查当前位置附近的键名。'
  if (/comma|delimiter|after property value/i.test(message)) return '请检查上一项末尾是否缺少逗号，或是否存在多余逗号。'
  if (/end of JSON|unterminated|unexpected end/i.test(message)) return '内容没有完整结束；请补齐缺少的引号、方括号或花括号。'
  if (/unexpected token|unexpected character/i.test(message)) return '请移除当前位置的非法字符，并检查相邻值的引号与分隔符。'
  return '请检查标记位置附近的引号、逗号和括号是否成对。'
}

export function locateJsonError(input: string, error: unknown): LocatedError {
  const raw = error instanceof Error ? error.message : 'JSON 语法错误'
  const explicit = raw.match(/line\s+(\d+)\s+column\s+(\d+)/i)
  const position = raw.match(/position\s+(\d+)/i)
  const location = explicit
    ? { line: Number(explicit[1]), column: Number(explicit[2]) }
    : offsetToLocation(input, position ? Number(position[1]) : 0)
  return {
    code: 'E_JSON_SYNTAX',
    message: `第 ${location.line} 行，第 ${location.column} 列：JSON 语法无效`,
    ...location,
    suggestion: suggestionFor(raw),
  }
}

export function formatJson(input: string): FormatResult {
  try {
    const parsed: unknown = JSON.parse(input)
    const output = JSON.stringify(parsed, null, 2)
    return { ok: true, output, machine: { ok: true, format: 'json', bytes: new Blob([output]).size } }
  } catch (error) {
    const located = locateJsonError(input, error)
    return { ok: false, error: located, machine: { ok: false, error: located } }
  }
}
