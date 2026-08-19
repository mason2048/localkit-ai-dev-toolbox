import { hasBuiltInSecret } from './redact'

export type ContextFinding = {
  level: 'blocked' | 'warning'
  code: string
  path: string
  message: string
  suggestion: string
}

export type ContextValidationReport = {
  reportVersion: '1'
  target: { format: 'context-package'; schemaVersion: '0.1' }
  ok: boolean
  status: 'pass' | 'warning' | 'blocked'
  summary: { checkedItems: number; blockers: number; warnings: number }
  findings: ContextFinding[]
}

const KINDS = ['repository', 'web', 'memory', 'rule', 'mixed']
const TYPES = ['fact', 'instruction', 'preference', 'workflow', 'reference', 'secret-warning']
const SCOPES = ['global', 'project', 'task']
const SENSITIVITY = ['public', 'internal', 'sensitive', 'secret']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/
const URN = /^urn:([a-z0-9][a-z0-9-]{0,30}[a-z0-9]):([a-z0-9()+,\-.:=@;$_!*'%/?#]+)$/i
const NON_EXECUTABLE_FENCE_LANGUAGES = new Set([
  'csv', 'diff', 'ini', 'json', 'json5', 'jsonc', 'log', 'mermaid', 'patch', 'properties',
  'svg', 'toml', 'tsv', 'xml', 'yaml', 'yml',
])

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validDate(value: unknown) {
  if (typeof value !== 'string') return false
  const match = value.match(RFC3339)
  if (!match) return false
  if (!Number.isFinite(Date.parse(value))) return false
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3])
  return month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function validSourceUri(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return false
  try {
    const parsed = new URL(value)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      if (!/^https?:\/\//i.test(value)) return false
      const authority = value.slice(value.indexOf('//') + 2).split(/[/?#]/, 1)[0]
      return Boolean(authority && parsed.hostname)
    }
    if (parsed.protocol === 'file:') {
      try { return decodeURIComponent(parsed.pathname).replaceAll('/', '').trim().length > 0 } catch { return false }
    }
    if (parsed.protocol === 'urn:') {
      const match = value.match(URN)
      return Boolean(match && !/%(?![0-9a-f]{2})/i.test(match[2]))
    }
    return false
  } catch { return false }
}

function isComparableRevision(value: unknown) {
  if (typeof value !== 'string') return false
  const revision = value.trim()
  return /^(?:[0-9a-f]{7,64}|sha(?:1|256|512):[0-9a-f]{7,128}|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))$/i.test(revision)
}

function containsEmbeddedExecutable(content: string) {
  let openFence: { marker: '`' | '~'; length: number } | null = null
  for (const line of content.split(/\r?\n/)) {
    if (openFence) {
      const close = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/)
      if (close && close[1][0] === openFence.marker && close[1].length >= openFence.length) openFence = null
      continue
    }
    const open = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*([^\s`~]*)[^\n]*$/)
    if (!open) continue
    const language = open[2].toLowerCase()
    // Unknown and unlabeled fences are fail-closed: only explicit, non-executable
    // data/document formats may be embedded in Context Package content.
    if (!NON_EXECUTABLE_FENCE_LANGUAGES.has(language)) return true
    openFence = { marker: open[1][0] as '`' | '~', length: open[1].length }
  }
  return /^\s*#!\//im.test(content)
    || /<script(?:\s|>)/i.test(content)
    || /(?:^|\n)\s*(?:rm\s+-[^\n]*r[^\n]*f|Remove-Item\s+[^\n]*-Recurse|(?:curl|wget)[^\n|]*\|\s*(?:sh|bash|zsh)|sudo\b|(?:eval|Function)\s*\(|globalThis\.[A-Za-z_$][\w$]*\s*\()/i.test(content)
}

function finding(findings: ContextFinding[], level: ContextFinding['level'], code: string, path: string, message: string, suggestion: string) {
  findings.push({ level, code, path, message, suggestion })
}

function requiredString(object: Record<string, unknown>, key: string, path: string, findings: ContextFinding[], nonEmpty = false) {
  if (!(key in object)) { finding(findings, 'blocked', 'REQUIRED_FIELD', `${path}/${key}`, `缺少必需字段 ${key}。`, `添加 ${key} 字段。`); return }
  if (typeof object[key] !== 'string' || (nonEmpty && !String(object[key]).trim())) finding(findings, 'blocked', 'INVALID_TYPE', `${path}/${key}`, `${key} 必须是${nonEmpty ? '非空' : ''}字符串。`, `将 ${key} 修改为${nonEmpty ? '非空' : ''}字符串。`)
}

function validateItem(value: unknown, index: number, findings: ContextFinding[], seen: Set<string>) {
  const path = `/items/${index}`
  if (!isObject(value)) { finding(findings, 'blocked', 'INVALID_ITEM', path, 'ContextItem 必须是对象。', '将该数组项修改为对象。'); return }
  for (const key of ['id', 'title', 'content', 'scope', 'sensitivity']) requiredString(value, key, path, findings, key === 'id')
  requiredString(value, 'type', path, findings)
  if (typeof value.type === 'string' && !TYPES.includes(value.type)) finding(findings, 'blocked', 'INVALID_ENUM', `${path}/type`, 'type 不属于协议枚举。', `使用 ${TYPES.join('、')} 之一。`)
  if (typeof value.scope === 'string' && !SCOPES.includes(value.scope)) finding(findings, 'blocked', 'INVALID_ENUM', `${path}/scope`, 'scope 不属于协议枚举。', `使用 ${SCOPES.join('、')} 之一。`)
  if (typeof value.sensitivity === 'string' && !SENSITIVITY.includes(value.sensitivity)) finding(findings, 'blocked', 'INVALID_ENUM', `${path}/sensitivity`, 'sensitivity 不属于协议枚举。', `使用 ${SENSITIVITY.join('、')} 之一。`)
  if (typeof value.id === 'string' && value.id.trim()) {
    if (seen.has(value.id)) finding(findings, 'warning', 'DUPLICATE_ITEM_ID', `${path}/id`, 'item id 与前项重复。', '为每个 ContextItem 使用稳定且唯一的 id。')
    seen.add(value.id)
  }
  if (!('tags' in value)) finding(findings, 'blocked', 'REQUIRED_FIELD', `${path}/tags`, '缺少必需字段 tags。', '添加字符串数组 tags。')
  else if (!Array.isArray(value.tags) || !value.tags.every((tag) => typeof tag === 'string')) finding(findings, 'blocked', 'INVALID_TYPE', `${path}/tags`, 'tags 必须是字符串数组。', '删除非字符串 tag。')

  if (!isObject(value.source)) finding(findings, 'blocked', 'INVALID_SOURCE', `${path}/source`, 'source 必须是对象。', '添加 uri、revision 和 locator。')
  else {
    requiredString(value.source, 'uri', `${path}/source`, findings, true)
    requiredString(value.source, 'revision', `${path}/source`, findings, true)
    requiredString(value.source, 'locator', `${path}/source`, findings, true)
    if (typeof value.source.uri === 'string' && !validSourceUri(value.source.uri)) finding(findings, 'blocked', 'UNLOCATABLE_SOURCE', `${path}/source/uri`, 'source.uri 必须是可定位且不可执行的 URI。', '使用 file://、https://、http:// 或 urn: 来源。')
    if (typeof value.source.revision === 'string' && value.source.revision.trim() && !isComparableRevision(value.source.revision)) finding(findings, 'blocked', 'UNVERIFIABLE_REVISION', `${path}/source/revision`, 'revision 不是可比较的哈希、提交 ID 或带时区时间戳。', '使用内容哈希、提交 SHA 或带时区时间戳。')
  }
  if (!isObject(value.validity)) finding(findings, 'blocked', 'INVALID_VALIDITY', `${path}/validity`, 'validity 必须是对象。', '添加 observedAt、expiresAt 和 confidence。')
  else {
    if (!validDate(value.validity.observedAt)) finding(findings, 'blocked', 'INVALID_DATE_TIME', `${path}/validity/observedAt`, 'observedAt 必须是带时区的 ISO-8601 时间。', '使用如 2026-08-12T10:00:00Z。')
    if (value.validity.expiresAt !== null && !validDate(value.validity.expiresAt)) finding(findings, 'blocked', 'INVALID_DATE_TIME', `${path}/validity/expiresAt`, 'expiresAt 必须为 null 或带时区时间。', '使用 null 或 ISO-8601 时间。')
    if (typeof value.validity.confidence !== 'number' || !Number.isFinite(value.validity.confidence) || value.validity.confidence < 0 || value.validity.confidence > 1) finding(findings, 'blocked', 'INVALID_CONFIDENCE', `${path}/validity/confidence`, 'confidence 必须是 0 到 1 的数字。', '将 confidence 调整到闭区间 [0,1]。')
    if (validDate(value.validity.observedAt) && validDate(value.validity.expiresAt) && Date.parse(value.validity.expiresAt as string) < Date.parse(value.validity.observedAt as string)) finding(findings, 'warning', 'EXPIRES_BEFORE_OBSERVED', `${path}/validity/expiresAt`, 'expiresAt 早于 observedAt。', '检查有效期时间顺序。')
  }
  if (typeof value.content === 'string') {
    if (hasBuiltInSecret(value.content)) finding(findings, 'blocked', 'PLAINTEXT_SECRET', `${path}/content`, 'content 含疑似明文密钥；报告未保留原值。', '用 secret-warning 项描述类别和位置，不要写入原密钥。')
    if (containsEmbeddedExecutable(value.content)) finding(findings, 'blocked', 'EMBEDDED_EXECUTABLE', `${path}/content`, 'content 中疑似嵌入可执行脚本。', '只在 source.uri 中引用脚本文件，不要把脚本嵌入协议。')
  }
}

export function validateContextPackage(value: unknown): ContextValidationReport {
  const findings: ContextFinding[] = []
  if (!isObject(value)) {
    finding(findings, 'blocked', 'INVALID_ROOT', '', 'Context Package 根必须是对象。', '使用 JSON 对象作为根结构。')
    return buildReport(0, findings)
  }
  for (const key of ['schemaVersion', 'packageId', 'name', 'kind', 'createdAt']) requiredString(value, key, '', findings)
  if (value.schemaVersion !== '0.1') finding(findings, 'blocked', 'UNSUPPORTED_VERSION', '/schemaVersion', 'schemaVersion 必须精确为 0.1。', '使用 Context Package v0.1。')
  if (typeof value.packageId === 'string' && !UUID.test(value.packageId)) finding(findings, 'blocked', 'INVALID_UUID', '/packageId', 'packageId 必须是合法 UUID。', '生成新的 UUID。')
  if (typeof value.kind === 'string' && !KINDS.includes(value.kind)) finding(findings, 'blocked', 'INVALID_ENUM', '/kind', 'kind 不属于协议枚举。', `使用 ${KINDS.join('、')} 之一。`)
  if (!validDate(value.createdAt)) finding(findings, 'blocked', 'INVALID_DATE_TIME', '/createdAt', 'createdAt 必须是带时区的 ISO-8601 时间。', '使用如 2026-08-12T10:00:00Z。')
  if (!isObject(value.producer)) finding(findings, 'blocked', 'INVALID_PRODUCER', '/producer', 'producer 必须是对象。', '添加 name 与 version 字符串。')
  else { requiredString(value.producer, 'name', '/producer', findings); requiredString(value.producer, 'version', '/producer', findings) }
  if (!Array.isArray(value.items)) finding(findings, 'blocked', 'INVALID_ITEMS', '/items', 'items 必须是数组。', '添加 ContextItem 数组，可为空。')
  else {
    const seen = new Set<string>()
    value.items.forEach((item, index) => validateItem(item, index, findings, seen))
  }
  if (!Array.isArray(value.warnings)) finding(findings, 'blocked', 'INVALID_WARNINGS', '/warnings', 'warnings 必须是数组。', '添加 warnings 数组，可为空且允许未知元素结构。')
  if (Array.isArray(value.items) && Array.isArray(value.warnings)) {
    const unlocatedInference = value.items.some((item) => isObject(item) && isObject(item.validity) && typeof item.validity.confidence === 'number' && item.validity.confidence < 0.5 && (!isObject(item.source) || !validSourceUri(item.source.uri)))
    if (unlocatedInference && value.warnings.length === 0) finding(findings, 'blocked', 'UNWARNED_INFERENCE', '/warnings', '低置信度且无法定位来源的推断必须加入 warnings。', '加入不含正文的推断来源警告。')
  }
  return buildReport(Array.isArray(value.items) ? value.items.length : 0, findings)
}

function buildReport(checkedItems: number, findings: ContextFinding[]): ContextValidationReport {
  const blockers = findings.filter((item) => item.level === 'blocked').length
  const warnings = findings.filter((item) => item.level === 'warning').length
  return {
    reportVersion: '1', target: { format: 'context-package', schemaVersion: '0.1' }, ok: blockers === 0,
    status: blockers ? 'blocked' : warnings ? 'warning' : 'pass', summary: { checkedItems, blockers, warnings }, findings,
  }
}

export function parseAndValidateContextPackage(input: string) {
  try { return { syntaxOk: true as const, report: validateContextPackage(JSON.parse(input) as unknown) } }
  catch { return { syntaxOk: false as const } }
}
