import { createReportId, SAFE_PRIVACY, type LocalKitReport } from './report'

export type SensitiveCategory = 'API 密钥' | '访问令牌' | '邮箱' | '中国大陆手机号' | '身份证号' | 'IP 地址' | '自定义规则'

export type CustomRedactionRule = {
  schema: 'localkit.redaction-rule/v1'
  id: string
  label: string
  enabled: boolean
  priority: number
  matcher:
    | { kind: 'literal'; value: string; caseSensitive: boolean }
    | { kind: 'mask'; value: string }
}

export type SensitiveHit = {
  ruleId: string
  category: SensitiveCategory
  line: number
  column: number
  ordinal: number
}

export type RedactionResult = {
  ok: true
  redactedText: string
  hits: SensitiveHit[]
  summary: Record<string, number>
} | {
  ok: false
  code: 'INPUT_TOO_LARGE' | 'INVALID_CUSTOM_RULE' | 'HIT_LIMIT_EXCEEDED'
  message: string
}

type InternalRule = { id: string; category: SensitiveCategory; priority: number; pattern: RegExp }
type InternalHit = { ruleId: string; category: SensitiveCategory; priority: number; start: number; end: number }

const MAX_INPUT_BYTES = 1024 * 1024
const MAX_RULES = 50
const MAX_HITS = 5000
const RULE_KEYS = ['schema', 'id', 'label', 'enabled', 'priority', 'matcher'] as const
const MATCHER_KEYS = {
  literal: ['kind', 'value', 'caseSensitive'],
  mask: ['kind', 'value'],
} as const

const BUILTIN_RULES: InternalRule[] = [
  { id: 'builtin.api-key', category: 'API 密钥', priority: 100, pattern: /\b(?:sk-[A-Za-z0-9_-]{16,}|AKIA[A-Z0-9]{16}|AIza[0-9A-Za-z_-]{20,})\b/g },
  { id: 'builtin.access-token', category: '访问令牌', priority: 100, pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9._~+/=-]{12,})\b/gi },
  { id: 'builtin.email', category: '邮箱', priority: 50, pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  { id: 'builtin.cn-phone', category: '中国大陆手机号', priority: 50, pattern: /(?<!\d)1[3-9]\d{9}(?!\d)/g },
  { id: 'builtin.cn-id', category: '身份证号', priority: 60, pattern: /(?<!\d)\d{17}[\dXx](?!\d)/g },
  { id: 'builtin.ipv4', category: 'IP 地址', priority: 20, pattern: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g },
]

function byteLength(text: string) { return new TextEncoder().encode(text).byteLength }
function escapeRegExp(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function validateRedactionRule(rule: CustomRedactionRule): { ok: true } | { ok: false; message: string } {
  if (!isObject(rule) || Object.keys(rule).some((key) => !RULE_KEYS.includes(key as typeof RULE_KEYS[number]))) return { ok: false, message: '规则含不支持的字段。' }
  if (rule.schema !== 'localkit.redaction-rule/v1') return { ok: false, message: '规则版本必须是 localkit.redaction-rule/v1。' }
  if (!/^[a-z][a-z0-9._-]{0,47}$/.test(rule.id)) return { ok: false, message: '规则 ID 只能包含小写字母、数字、点、下划线和连字符。' }
  if (typeof rule.label !== 'string' || !rule.label.trim() || rule.label.length > 40) return { ok: false, message: '规则名称需为 1–40 个字符。' }
  if (typeof rule.enabled !== 'boolean') return { ok: false, message: 'enabled 必须是布尔值。' }
  if (!Number.isInteger(rule.priority) || rule.priority < 0 || rule.priority > 100) return { ok: false, message: '优先级需为 0–100 的整数。' }
  if (!isObject(rule.matcher)) return { ok: false, message: 'matcher 必须是对象。' }
  if (rule.matcher.kind !== 'literal' && rule.matcher.kind !== 'mask') return { ok: false, message: '匹配方式只支持固定文本或简单掩码。' }
  if (Object.keys(rule.matcher).some((key) => !MATCHER_KEYS[rule.matcher.kind].includes(key as never))) return { ok: false, message: 'matcher 含不支持的字段。' }
  if (rule.matcher.kind === 'literal' && typeof rule.matcher.caseSensitive !== 'boolean') return { ok: false, message: 'caseSensitive 必须是布尔值。' }
  if (typeof rule.matcher.value !== 'string' || !rule.matcher.value || rule.matcher.value.length > 256) return { ok: false, message: '匹配内容需为 1–256 个字符。' }
  if (rule.matcher.kind === 'mask' && !/[#Aa?]/.test(rule.matcher.value)) return { ok: false, message: '简单掩码至少包含一个占位符：# 数字、A 大写、a 小写、? 字母或数字。' }
  return { ok: true }
}

function maskPattern(mask: string) {
  return [...mask].map((character) => character === '#' ? '[0-9]'
    : character === 'A' ? '[A-Z]'
      : character === 'a' ? '[a-z]'
        : character === '?' ? '[A-Za-z0-9]'
          : escapeRegExp(character)).join('')
}

function customPattern(rule: CustomRedactionRule) {
  if (rule.matcher.kind === 'literal') return new RegExp(escapeRegExp(rule.matcher.value), rule.matcher.caseSensitive ? 'g' : 'gi')
  return new RegExp(maskPattern(rule.matcher.value), 'g')
}

function locate(lineStarts: number[], offset: number) {
  let low = 0
  let high = lineStarts.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (lineStarts[middle] <= offset) low = middle + 1
    else high = middle
  }
  const lineIndex = Math.max(0, low - 1)
  return { line: lineIndex + 1, column: offset - lineStarts[lineIndex] + 1 }
}

export function scanAndRedact(text: string, customRules: CustomRedactionRule[] = []): RedactionResult {
  if (byteLength(text) > MAX_INPUT_BYTES) return { ok: false, code: 'INPUT_TOO_LARGE', message: '输入超过 1 MiB 安全上限。' }
  const ids = new Set<string>()
  if (customRules.length > MAX_RULES || customRules.some((rule) => !validateRedactionRule(rule).ok || ids.has(rule.id) || !ids.add(rule.id))) {
    return { ok: false, code: 'INVALID_CUSTOM_RULE', message: '自定义规则无效或超过 50 条上限。' }
  }
  const rules: InternalRule[] = [
    ...BUILTIN_RULES,
    ...customRules.filter((rule) => rule.enabled).map((rule, index) => ({ id: `custom-${String(index + 1).padStart(3, '0')}`, category: '自定义规则' as const, priority: rule.priority, pattern: customPattern(rule) })),
  ]
  const candidates: InternalHit[] = []
  for (const rule of rules) {
    rule.pattern.lastIndex = 0
    for (const match of text.matchAll(rule.pattern)) {
      if (!match[0].length) continue
      candidates.push({ ruleId: rule.id, category: rule.category, priority: rule.priority, start: match.index, end: match.index + match[0].length })
      if (candidates.length > MAX_HITS * 2) return { ok: false, code: 'HIT_LIMIT_EXCEEDED', message: '潜在命中超过安全上限；未生成部分脱敏结果。' }
    }
  }
  candidates.sort((a, b) => b.priority - a.priority || (b.end - b.start) - (a.end - a.start) || a.start - b.start || a.ruleId.localeCompare(b.ruleId))
  const occupied = new Uint8Array(text.length)
  const accepted: InternalHit[] = []
  for (const candidate of candidates) {
    let overlaps = false
    for (let index = candidate.start; index < candidate.end; index += 1) if (occupied[index]) { overlaps = true; break }
    if (overlaps) continue
    for (let index = candidate.start; index < candidate.end; index += 1) occupied[index] = 1
    accepted.push(candidate)
    if (accepted.length > MAX_HITS) return { ok: false, code: 'HIT_LIMIT_EXCEEDED', message: '命中超过 5000 项安全上限；未生成部分脱敏结果。' }
  }
  accepted.sort((a, b) => a.start - b.start || a.ruleId.localeCompare(b.ruleId))
  const lineStarts = [0]
  for (let index = 0; index < text.length; index += 1) if (text[index] === '\n') lineStarts.push(index + 1)
  const ordinals = new Map<string, number>()
  let cursor = 0
  let redactedText = ''
  const hits: SensitiveHit[] = []
  for (const hit of accepted) {
    const ordinal = (ordinals.get(hit.ruleId) ?? 0) + 1
    ordinals.set(hit.ruleId, ordinal)
    redactedText += text.slice(cursor, hit.start) + `[已脱敏:${hit.ruleId}_${ordinal}]`
    cursor = hit.end
    hits.push({ ruleId: hit.ruleId, category: hit.category, ...locate(lineStarts, hit.start), ordinal })
  }
  redactedText += text.slice(cursor)
  return { ok: true, redactedText, hits, summary: sensitiveSummary(hits) }
}

export function detectSensitive(text: string, customRules: CustomRedactionRule[] = []) {
  const result = scanAndRedact(text, customRules)
  return result.ok ? result.hits : []
}

export function hasBuiltInSecret(text: string) {
  for (const rule of BUILTIN_RULES.slice(0, 2)) {
    rule.pattern.lastIndex = 0
    if (rule.pattern.test(text)) return true
  }
  return false
}

export function redactText(text: string, customRules: CustomRedactionRule[] = []) {
  const result = scanAndRedact(text, customRules)
  return result.ok ? result.redactedText : ''
}

export function sensitiveSummary(hits: SensitiveHit[]) {
  return hits.reduce<Record<string, number>>((summary, hit) => {
    summary[hit.category] = (summary[hit.category] ?? 0) + 1
    return summary
  }, {})
}

export function buildSafeRedactionReport(result: Extract<RedactionResult, { ok: true }>, reportId = createReportId()): LocalKitReport {
  const firstByRule = new Map<string, SensitiveHit>()
  result.hits.forEach((hit) => { if (!firstByRule.has(hit.ruleId)) firstByRule.set(hit.ruleId, hit) })
  const findings = [...firstByRule.values()].map((hit) => ({ level: 'warning' as const, code: 'SENSITIVE_VALUES_REDACTED', ruleId: hit.ruleId, line: hit.line, column: hit.column }))
  return {
    schema: 'localkit.report/v1', reportId, tool: 'redact', status: result.hits.length ? 'warning' : 'pass',
    summary: { checkedUnits: 1, blocked: 0, warning: findings.length, passed: findings.length ? 0 : 1 },
    findings,
    privacy: { ...SAFE_PRIVACY },
  }
}
