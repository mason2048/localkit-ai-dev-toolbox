import { parseDocument } from 'yaml'
import { hasBuiltInSecret } from './redact'
import { createReportId, SAFE_PRIVACY, type LocalKitReport } from './report'
import type { Finding, FindingLevel } from './types'

export type VirtualFile = { path: string; content: string }
export type SkillReport = { status: FindingLevel; findings: Finding[]; checkedFiles: number }
export type SkillBatchUnit = { label: string; files: VirtualFile[] }
export type SkillBatchResult = { units: Array<{ subjectId: string; label: string; report: SkillReport }>; report: LocalKitReport }
export type SkillBatchValidation = SkillBatchResult | { error: { code: string; message: string } }

export type SkillPolicyRule =
  | { id: string; level: 'blocked' | 'warning'; check: { kind: 'content-contains'; value: string; caseSensitive?: boolean } }
  | { id: string; level: 'blocked' | 'warning'; check: { kind: 'frontmatter-required'; key: string } }
  | { id: string; level: 'blocked' | 'warning'; check: { kind: 'frontmatter-equals'; key: string; value: string } }
  | { id: string; level: 'blocked' | 'warning'; check: { kind: 'required-file'; path: string } }

export type SkillPolicy = { schema: 'localkit.skill-policy/v1'; rules: SkillPolicyRule[] }

const DANGEROUS = [
  { code: 'DANGER_DELETE', pattern: /\brm\s+-[^\n]*r[^\n]*f|Remove-Item\s+[^\n]*-Recurse[^\n]*-Force/i, message: '发现递归强制删除命令。' },
  { code: 'DANGER_PIPE_SHELL', pattern: /(?:curl|wget)[^\n|]*\|\s*(?:sh|bash|zsh)/i, message: '发现下载内容直接传入 Shell 的命令。' },
  { code: 'DANGER_PRIVILEGE', pattern: /\bsudo\b|chmod\s+777/i, message: '发现提权或过度放宽权限的命令。' },
  { code: 'DANGER_DYNAMIC_EXEC', pattern: /\beval\s*\(|child_process\.(?:exec|spawn)|os\.system\s*\(|shell\s*=\s*True/i, message: '发现动态执行系统命令的代码。' },
]
const POLICY_ID = /^[a-z][a-z0-9._-]{0,47}$/
const POLICY_KEY = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/
const SAFE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]{1,256}$/

function lineOf(content: string, offset: number) { return content.slice(0, offset).split('\n').length }
function normalize(path: string) {
  const parts: string[] = []
  for (const part of path.replaceAll('\\', '/').split('/')) {
    if (!part || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return parts.join('/')
}
function resolveFrom(base: string, target: string) {
  const folder = base.includes('/') ? base.slice(0, base.lastIndexOf('/')) : ''
  return normalize(`${folder}/${target.split('#')[0]}`)
}
function frontmatter(content: string) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---(?:\s*\n|$)/)
  if (!match) return { error: '缺少以 --- 包围的 YAML frontmatter。' }
  try {
    const document = parseDocument(match[1], { prettyErrors: false })
    if (document.errors.length) return { error: 'frontmatter 不是有效 YAML。' }
    const value: unknown = document.toJS({ maxAliasCount: 10 })
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: 'frontmatter 根必须是键值对象。' }
    return { value: value as Record<string, unknown> }
  } catch {
    return { error: 'frontmatter 超出安全解析边界。' }
  }
}

export function parseSkillPolicy(input: string): { ok: true; policy: SkillPolicy } | { ok: false; code: string; message: string } {
  if (new TextEncoder().encode(input).byteLength > 64 * 1024) return { ok: false, code: 'POLICY_TOO_LARGE', message: '策略超过 64 KiB 上限。' }
  let value: unknown
  try { value = JSON.parse(input) }
  catch { return { ok: false, code: 'INVALID_POLICY_JSON', message: '策略必须是有效 JSON。' } }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, code: 'INVALID_POLICY_SCHEMA', message: '策略根必须是对象。' }
  const root = value as Record<string, unknown>
  if (Object.keys(root).some((key) => !['schema', 'rules'].includes(key)) || root.schema !== 'localkit.skill-policy/v1' || !Array.isArray(root.rules) || root.rules.length > 50) return { ok: false, code: 'INVALID_POLICY_SCHEMA', message: '策略版本、字段或规则数量无效。' }
  const rules: SkillPolicyRule[] = []
  const ruleIds = new Set<string>()
  for (const raw of root.rules) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, code: 'INVALID_POLICY_RULE', message: '策略规则必须是对象。' }
    const rule = raw as Record<string, unknown>
    if (Object.keys(rule).some((key) => !['id', 'level', 'check'].includes(key)) || typeof rule.id !== 'string' || !POLICY_ID.test(rule.id) || (rule.level !== 'blocked' && rule.level !== 'warning') || !rule.check || typeof rule.check !== 'object' || Array.isArray(rule.check)) return { ok: false, code: 'INVALID_POLICY_RULE', message: '规则 ID、级别或 check 无效。' }
    const check = rule.check as Record<string, unknown>
    if (ruleIds.has(rule.id as string)) return { ok: false, code: 'DUPLICATE_POLICY_RULE', message: '策略规则 ID 不能重复。' }
    ruleIds.add(rule.id as string)
    const common = { id: rule.id, level: rule.level } as const
    if (check.kind === 'content-contains' && Object.keys(check).every((key) => ['kind', 'value', 'caseSensitive'].includes(key)) && typeof check.value === 'string' && check.value.length >= 1 && check.value.length <= 256 && (check.caseSensitive === undefined || typeof check.caseSensitive === 'boolean')) rules.push({ ...common, check: { kind: 'content-contains', value: check.value, caseSensitive: check.caseSensitive as boolean | undefined } })
    else if (check.kind === 'frontmatter-required' && Object.keys(check).every((key) => ['kind', 'key'].includes(key)) && typeof check.key === 'string' && POLICY_KEY.test(check.key)) rules.push({ ...common, check: { kind: 'frontmatter-required', key: check.key } })
    else if (check.kind === 'frontmatter-equals' && Object.keys(check).every((key) => ['kind', 'key', 'value'].includes(key)) && typeof check.key === 'string' && POLICY_KEY.test(check.key) && typeof check.value === 'string' && check.value.length <= 256) rules.push({ ...common, check: { kind: 'frontmatter-equals', key: check.key, value: check.value } })
    else if (check.kind === 'required-file' && Object.keys(check).every((key) => ['kind', 'path'].includes(key)) && typeof check.path === 'string' && SAFE_PATH.test(check.path)) rules.push({ ...common, check: { kind: 'required-file', path: check.path } })
    else return { ok: false, code: 'UNSUPPORTED_POLICY_CHECK', message: '策略含不支持或不安全的 check。' }
  }
  return { ok: true, policy: { schema: 'localkit.skill-policy/v1', rules } }
}

export function validateSkill(files: VirtualFile[], policy?: SkillPolicy): SkillReport {
  if (files.length > 256) return { status: 'blocked', checkedFiles: files.length, findings: [{ level: 'blocked', code: 'FILE_COUNT_LIMIT', message: '文本文件超过 256 个安全上限。' }] }
  const fileSizes = files.map((file) => new TextEncoder().encode(file.content).byteLength)
  if (fileSizes.some((size) => size > 1024 * 1024)) return { status: 'blocked', checkedFiles: files.length, findings: [{ level: 'blocked', code: 'FILE_SIZE_LIMIT', message: '单个文本文件超过 1 MiB 安全上限。' }] }
  if (fileSizes.reduce((sum, size) => sum + size, 0) > 16 * 1024 * 1024) return { status: 'blocked', checkedFiles: files.length, findings: [{ level: 'blocked', code: 'TOTAL_SIZE_LIMIT', message: '文本总量超过 16 MiB 安全上限。' }] }
  const normalized = files.map((file) => ({ ...file, path: normalize(file.path) }))
  const findings: Finding[] = []
  const skillFile = normalized.find((file) => file.path === 'SKILL.md' || file.path.endsWith('/SKILL.md'))
  if (!skillFile) return { status: 'blocked', checkedFiles: files.length, findings: [{ level: 'blocked', code: 'MISSING_SKILL', message: '目录中缺少 SKILL.md。' }] }
  const rootPrefix = skillFile.path.slice(0, -'SKILL.md'.length)
  const inRoot = normalized.map((file) => ({ ...file, path: file.path.startsWith(rootPrefix) ? file.path.slice(rootPrefix.length) : file.path }))
  const main = inRoot.find((file) => file.path === 'SKILL.md')!
  const meta = frontmatter(main.content)
  if (meta.error) findings.push({ level: 'blocked', code: 'INVALID_FRONTMATTER', message: meta.error, file: 'SKILL.md', line: 1 })
  else {
    if (typeof meta.value?.name !== 'string' || !meta.value.name.trim()) findings.push({ level: 'blocked', code: 'MISSING_NAME', message: 'frontmatter 缺少非空 name。', file: 'SKILL.md', line: 1 })
    if (typeof meta.value?.description !== 'string' || !meta.value.description.trim()) findings.push({ level: 'warning', code: 'MISSING_DESCRIPTION', message: 'frontmatter 缺少清晰的 description。', file: 'SKILL.md', line: 1 })
  }
  const knownPaths = new Set(inRoot.map((file) => file.path))
  const references = [...main.content.matchAll(/\[[^\]]*\]\((?!https?:|mailto:|#)([^)]+)\)/g)]
  for (const match of references) {
    const target = resolveFrom('SKILL.md', match[1].trim())
    if (target && !knownPaths.has(target)) findings.push({ level: 'warning', code: 'MISSING_REFERENCE', message: '发现不存在的本地文件引用。', file: 'SKILL.md', line: lineOf(main.content, match.index) })
  }
  for (const file of inRoot) {
    for (const danger of DANGEROUS) {
      const match = danger.pattern.exec(file.content)
      if (match) findings.push({ level: 'blocked', code: danger.code, message: danger.message, file: file.path, line: lineOf(file.content, match.index) })
    }
    if (hasBuiltInSecret(file.content)) findings.push({ level: 'blocked', code: 'POSSIBLE_SECRET', message: '发现疑似 API 密钥或访问令牌；报告不包含原值。', file: file.path })
  }
  if (policy) for (const [ruleIndex, rule] of policy.rules.entries()) {
    const safeRuleId = `policy-${String(ruleIndex + 1).padStart(3, '0')}`
    const add = (file = 'SKILL.md', line?: number) => findings.push({ level: rule.level, code: 'CUSTOM_POLICY', ruleId: safeRuleId, message: `自定义策略规则未通过：${rule.id}`, file, line })
    if (rule.check.kind === 'required-file' && !knownPaths.has(normalize(rule.check.path))) add()
    else if (rule.check.kind === 'frontmatter-required' && (!meta.value || !Object.hasOwn(meta.value, rule.check.key))) add()
    else if (rule.check.kind === 'frontmatter-equals' && (!meta.value || meta.value[rule.check.key] !== rule.check.value)) add()
    else if (rule.check.kind === 'content-contains') {
      for (const file of inRoot) {
        const haystack = rule.check.caseSensitive ? file.content : file.content.toLocaleLowerCase()
        const needle = rule.check.caseSensitive ? rule.check.value : rule.check.value.toLocaleLowerCase()
        const offset = haystack.indexOf(needle)
        if (offset >= 0) { add(file.path, lineOf(file.content, offset)); break }
      }
    }
  }
  if (!findings.length) findings.push({ level: 'pass', code: 'PASS', message: 'frontmatter、文件引用和静态安全检查均通过。', file: 'SKILL.md' })
  const status: FindingLevel = findings.some((item) => item.level === 'blocked') ? 'blocked' : findings.some((item) => item.level === 'warning') ? 'warning' : 'pass'
  return { status, findings, checkedFiles: files.length }
}

export function buildSafeSkillReport(units: Array<{ report: SkillReport }>, reportId = createReportId()): LocalKitReport {
  const findings = units.flatMap((unit, unitIndex) => {
    const subjectId = `item-${String(unitIndex + 1).padStart(3, '0')}`
    const grouped = new Map<string, { level: 'blocked' | 'warning'; code: string; subjectId: string; ruleId?: string; line?: number }>()
    unit.report.findings.filter((item) => item.level !== 'pass').forEach((item) => {
      const key = `${item.level}\0${item.code}\0${item.ruleId ?? ''}`
      if (!grouped.has(key)) grouped.set(key, { level: item.level as 'blocked' | 'warning', code: item.code, subjectId, ruleId: item.ruleId, line: item.line })
    })
    return [...grouped.values()]
  })
  const blocked = findings.filter((item) => item.level === 'blocked').length
  const warning = findings.filter((item) => item.level === 'warning').length
  return {
    schema: 'localkit.report/v1', reportId, tool: 'skill', status: blocked ? 'blocked' : warning ? 'warning' : 'pass',
    summary: { checkedUnits: units.length, blocked, warning, passed: units.filter((unit) => unit.report.status === 'pass').length },
    findings, privacy: { ...SAFE_PRIVACY },
  }
}

export function validateSkillBatch(units: SkillBatchUnit[], policy?: SkillPolicy): SkillBatchValidation {
  if (!units.length) return { error: { code: 'EMPTY_SKILL_BATCH', message: '请至少添加一个 Skill 对象。' } }
  if (units.length > 20) return { error: { code: 'SKILL_BATCH_LIMIT', message: 'Skill 对象超过 20 个上限；未执行部分校验。' } }
  const totalFiles = units.reduce((sum, unit) => sum + unit.files.length, 0)
  const totalBytes = units.reduce((sum, unit) => sum + unit.files.reduce((fileSum, file) => fileSum + new TextEncoder().encode(file.content).byteLength, 0), 0)
  if (totalFiles > 256) return { error: { code: 'FILE_COUNT_LIMIT', message: '全部 Skill 对象合计超过 256 个文本文件。' } }
  if (totalBytes > 16 * 1024 * 1024) return { error: { code: 'TOTAL_SIZE_LIMIT', message: '全部 Skill 对象合计超过 16 MiB 文本上限。' } }
  const results = units.map((unit, index) => ({ subjectId: `item-${String(index + 1).padStart(3, '0')}`, label: unit.label, report: validateSkill(unit.files, policy) }))
  return { units: results, report: buildSafeSkillReport(results) }
}
