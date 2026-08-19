export type ToolId = 'json' | 'yaml' | 'diff' | 'tokens' | 'redact' | 'skill'

export type LocatedError = {
  code: string
  message: string
  line: number
  column: number
  suggestion: string
}

export type FormatResult =
  | { ok: true; output: string; machine: Record<string, unknown> }
  | { ok: false; error: LocatedError; machine: Record<string, unknown> }

export type FindingLevel = 'blocked' | 'warning' | 'pass'

export type Finding = {
  level: FindingLevel
  code: string
  message: string
  ruleId?: string
  file?: string
  line?: number
}
