export type ReportTool = 'redact' | 'skill'
export type ReportStatus = 'pass' | 'warning' | 'blocked' | 'error'

export type SafeReportFinding = {
  level: 'blocked' | 'warning'
  code: string
  subjectId?: string
  ruleId?: string
  line?: number
  column?: number
}

export type LocalKitReport = {
  schema: 'localkit.report/v1'
  reportId: string
  tool: ReportTool
  status: ReportStatus
  summary: { checkedUnits: number; blocked: number; warning: number; passed: number }
  findings: SafeReportFinding[]
  privacy: {
    localOnly: true
    containsInput: false
    containsMatchedValues: false
    containsRawPaths: false
  }
}

export type RejectedReport = { sourceIndex: number; code: string }

export type BatchReport = {
  schema: 'localkit.batch-report/v1'
  status: ReportStatus
  sources: { accepted: number; rejected: number; duplicates: number }
  byTool: Record<ReportTool, number>
  byStatus: Record<ReportStatus, number>
  byCode: Record<string, number>
  reports: Array<Pick<LocalKitReport, 'reportId' | 'tool' | 'status' | 'summary'>>
  rejected: RejectedReport[]
  privacy: LocalKitReport['privacy']
}

export const SAFE_PRIVACY: LocalKitReport['privacy'] = {
  localOnly: true,
  containsInput: false,
  containsMatchedValues: false,
  containsRawPaths: false,
}

const IDENTIFIER = /^[a-z][a-z0-9._-]{0,63}$/
const SUBJECT = /^(?:file|item)-\d{3,6}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const FORBIDDEN_KEYS = new Set(['input', 'output', 'content', 'value', 'match', 'snippet', 'before', 'after', 'path', 'message', 'filename', 'fileName'])
const SECRET_PATTERNS = [
  /\b(?:sk-[A-Za-z0-9_-]{16,}|AKIA[A-Z0-9]{16}|AIza[0-9A-Za-z_-]{20,})\b/,
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9._~+/=-]{12,})\b/i,
  /(?<!\d)1[3-9]\d{9}(?!\d)/,
  /(?<!\d)\d{17}[\dXx](?!\d)/,
  /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
]

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  return Object.keys(value).every((key) => allowed.includes(key))
}

function containsForbiddenKey(value: unknown, depth = 0): boolean {
  if (depth > 12) return true
  if (Array.isArray(value)) return value.some((item) => containsForbiddenKey(item, depth + 1))
  if (!isObject(value)) return false
  return Object.entries(value).some(([key, item]) => FORBIDDEN_KEYS.has(key) || containsForbiddenKey(item, depth + 1))
}

function containsSecret(value: unknown, depth = 0): boolean {
  if (depth > 12) return true
  if (typeof value === 'string') return SECRET_PATTERNS.some((pattern) => pattern.test(value))
  if (Array.isArray(value)) return value.some((item) => containsSecret(item, depth + 1))
  if (!isObject(value)) return false
  return Object.values(value).some((item) => containsSecret(item, depth + 1))
}

function validSummary(value: unknown): value is LocalKitReport['summary'] {
  if (!isObject(value) || !exactKeys(value, ['checkedUnits', 'blocked', 'warning', 'passed'])) return false
  return ['checkedUnits', 'blocked', 'warning', 'passed'].every((key) => Number.isSafeInteger(value[key]) && Number(value[key]) >= 0)
}

function validPrivacy(value: unknown): value is LocalKitReport['privacy'] {
  return isObject(value)
    && exactKeys(value, ['localOnly', 'containsInput', 'containsMatchedValues', 'containsRawPaths'])
    && value.localOnly === true
    && value.containsInput === false
    && value.containsMatchedValues === false
    && value.containsRawPaths === false
}

function validFinding(value: unknown): value is SafeReportFinding {
  if (!isObject(value) || !exactKeys(value, ['level', 'code', 'subjectId', 'ruleId', 'line', 'column'])) return false
  if (value.level !== 'blocked' && value.level !== 'warning') return false
  if (typeof value.code !== 'string' || !/^[A-Z][A-Z0-9_]{1,63}$/.test(value.code)) return false
  if (value.subjectId !== undefined && (typeof value.subjectId !== 'string' || !SUBJECT.test(value.subjectId))) return false
  if (value.ruleId !== undefined && (typeof value.ruleId !== 'string' || !IDENTIFIER.test(value.ruleId))) return false
  if (value.line !== undefined && (!Number.isSafeInteger(value.line) || Number(value.line) < 1)) return false
  if (value.column !== undefined && (!Number.isSafeInteger(value.column) || Number(value.column) < 1)) return false
  return true
}

export function createReportId() {
  return crypto.randomUUID()
}

export function parseSafeReport(input: string): { ok: true; report: LocalKitReport } | { ok: false; code: string } {
  if (new Blob([input]).size > 256 * 1024) return { ok: false, code: 'REPORT_TOO_LARGE' }
  let value: unknown
  try { value = JSON.parse(input) }
  catch { return { ok: false, code: 'INVALID_REPORT_JSON' } }
  if (containsForbiddenKey(value)) return { ok: false, code: 'UNSAFE_REPORT_FIELD' }
  if (containsSecret(value)) return { ok: false, code: 'POSSIBLE_SECRET_IN_REPORT' }
  if (!isObject(value)) return { ok: false, code: 'INVALID_REPORT_SCHEMA' }
  if (!exactKeys(value, ['schema', 'reportId', 'tool', 'status', 'summary', 'findings', 'privacy'])) return { ok: false, code: 'INVALID_REPORT_SCHEMA' }
  if (value.schema !== 'localkit.report/v1') return { ok: false, code: value.schema ? 'UNSAFE_LEGACY_REPORT' : 'INVALID_REPORT_SCHEMA' }
  if (typeof value.reportId !== 'string' || !UUID.test(value.reportId)) return { ok: false, code: 'INVALID_REPORT_ID' }
  if (value.tool !== 'redact' && value.tool !== 'skill') return { ok: false, code: 'INVALID_REPORT_TOOL' }
  if (!['pass', 'warning', 'blocked', 'error'].includes(String(value.status))) return { ok: false, code: 'INVALID_REPORT_STATUS' }
  if (!validSummary(value.summary) || !validPrivacy(value.privacy)) return { ok: false, code: 'INVALID_REPORT_SCHEMA' }
  if (!Array.isArray(value.findings) || value.findings.length > 5000 || !value.findings.every(validFinding)) return { ok: false, code: 'INVALID_REPORT_FINDINGS' }
  const blocked = value.findings.filter((finding) => isObject(finding) && finding.level === 'blocked').length
  const warning = value.findings.filter((finding) => isObject(finding) && finding.level === 'warning').length
  if (value.summary.blocked !== blocked || value.summary.warning !== warning) return { ok: false, code: 'INCONSISTENT_REPORT_SUMMARY' }
  if (value.summary.checkedUnits === 0 || value.summary.passed > value.summary.checkedUnits || blocked + warning + value.summary.passed < 1) return { ok: false, code: 'INCONSISTENT_REPORT_SUMMARY' }
  const expectedStatus: ReportStatus = blocked ? 'blocked' : warning ? 'warning' : value.status === 'error' ? 'error' : 'pass'
  if (value.status !== expectedStatus) return { ok: false, code: 'INCONSISTENT_REPORT_STATUS' }
  return {
    ok: true,
    report: {
      schema: 'localkit.report/v1',
      reportId: value.reportId,
      tool: value.tool,
      status: value.status as ReportStatus,
      summary: { ...value.summary },
      findings: value.findings.map((finding) => ({ ...finding })),
      privacy: { ...SAFE_PRIVACY },
    },
  }
}

export function mergeSafeReports(inputs: string[]): BatchReport {
  if (!inputs.length) return { schema: 'localkit.batch-report/v1', status: 'error', sources: { accepted: 0, rejected: 1, duplicates: 0 }, byTool: { redact: 0, skill: 0 }, byStatus: { pass: 0, warning: 0, blocked: 0, error: 0 }, byCode: {}, reports: [], rejected: [{ sourceIndex: 1, code: 'EMPTY_REPORT_BATCH' }], privacy: { ...SAFE_PRIVACY } }
  const limited = inputs.slice(0, 100)
  const accepted: LocalKitReport[] = []
  const rejected: RejectedReport[] = []
  const ids = new Set<string>()
  let duplicates = 0
  let findingsCount = 0
  let totalBytes = 0

  limited.forEach((input, sourceIndex) => {
    const inputBytes = new TextEncoder().encode(input).byteLength
    totalBytes += inputBytes
    if (totalBytes > 10 * 1024 * 1024) { rejected.push({ sourceIndex: sourceIndex + 1, code: 'BATCH_SIZE_LIMIT_EXCEEDED' }); return }
    const result = parseSafeReport(input)
    if (!result.ok) { rejected.push({ sourceIndex: sourceIndex + 1, code: result.code }); return }
    if (ids.has(result.report.reportId)) { duplicates += 1; return }
    if (findingsCount + result.report.findings.length > 5000) { rejected.push({ sourceIndex: sourceIndex + 1, code: 'FINDING_LIMIT_EXCEEDED' }); return }
    ids.add(result.report.reportId)
    findingsCount += result.report.findings.length
    accepted.push(result.report)
  })
  for (let index = limited.length; index < inputs.length; index += 1) rejected.push({ sourceIndex: index + 1, code: 'REPORT_LIMIT_EXCEEDED' })

  const byTool: Record<ReportTool, number> = { redact: 0, skill: 0 }
  const byStatus: Record<ReportStatus, number> = { pass: 0, warning: 0, blocked: 0, error: 0 }
  const byCode: Record<string, number> = {}
  accepted.forEach((report) => {
    byTool[report.tool] += 1
    byStatus[report.status] += 1
    report.findings.forEach((finding) => { byCode[finding.code] = (byCode[finding.code] ?? 0) + 1 })
  })
  const status: ReportStatus = accepted.some((report) => report.status === 'blocked') ? 'blocked'
    : accepted.some((report) => report.status === 'warning') ? 'warning'
      : accepted.some((report) => report.status === 'error') || rejected.length ? 'error' : 'pass'
  return {
    schema: 'localkit.batch-report/v1', status,
    sources: { accepted: accepted.length, rejected: rejected.length, duplicates },
    byTool, byStatus, byCode: Object.fromEntries(Object.entries(byCode).sort(([a], [b]) => a.localeCompare(b))),
    reports: accepted.map(({ reportId, tool, status: reportStatus, summary }) => ({ reportId, tool, status: reportStatus, summary: { ...summary } })),
    rejected, privacy: { ...SAFE_PRIVACY },
  }
}
