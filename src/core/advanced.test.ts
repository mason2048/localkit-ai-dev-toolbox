import { describe, expect, it, vi } from 'vitest'
import { validateContextPackage } from './context-package'
import { buildSafeRedactionReport, scanAndRedact, validateRedactionRule, type CustomRedactionRule } from './redact'
import { mergeSafeReports, parseSafeReport, SAFE_PRIVACY } from './report'
import { buildSafeSkillReport, parseSkillPolicy, validateSkill, validateSkillBatch } from './skill'
import { countExactTokens, encodeExact, TOKEN_PROFILES } from './tokens'

const providerStyleTestSecret = () => ['sk', 'example1234567890abcdef'].join('-')

const VALID_CONTEXT = {
  schemaVersion: '0.1', packageId: '5b7714a4-70fc-4e8c-a4f1-a8d8e0c9f203', name: 'example', kind: 'mixed',
  createdAt: '2026-08-12T15:00:00Z', producer: { name: 'test', version: 'dev' }, warnings: [],
  items: [{ id: 'item-1', type: 'fact', title: '', content: 'safe', scope: 'project', source: { uri: 'file:///README.md', revision: 'sha256:abcdef1234567890', locator: 'line 1' }, validity: { observedAt: '2026-08-12T15:00:00+08:00', expiresAt: null, confidence: 0 }, sensitivity: 'internal', tags: [] }],
}

describe('Context Package v0.1', () => {
  it('完整有效包通过且忽略未知字段', () => {
    const report = validateContextPackage({ ...VALID_CONTEXT, futureField: true, producer: { ...VALID_CONTEXT.producer, future: 'ignored' }, items: [{ ...VALID_CONTEXT.items[0], future: { any: true } }] })
    expect(report.status).toBe('pass')
    expect(report.summary.checkedItems).toBe(1)
  })

  it('一次返回多项字段路径和修复建议', () => {
    const report = validateContextPackage({ ...VALID_CONTEXT, packageId: 'bad', kind: 'other', items: [{ ...VALID_CONTEXT.items[0], source: { uri: 'x', revision: '', locator: '' }, validity: { observedAt: 'bad', expiresAt: null, confidence: 2 } }] })
    expect(report.status).toBe('blocked')
    expect(report.findings.map((item) => item.path)).toEqual(expect.arrayContaining(['/packageId', '/kind', '/items/0/source/revision', '/items/0/validity/confidence']))
    expect(report.findings.every((item) => item.suggestion.length > 0)).toBe(true)
  })

  it('根类型、合法 UUID v7、严格日历和深层未知字段边界明确', () => {
    for (const root of [null, [], 'x', 1]) expect(validateContextPackage(root).findings[0].code).toBe('INVALID_ROOT')
    const validV7 = { ...VALID_CONTEXT, packageId: '018f5b2e-7c9a-7abc-8def-1234567890ab', items: [{ ...VALID_CONTEXT.items[0], source: { ...VALID_CONTEXT.items[0].source, extra: true }, validity: { ...VALID_CONTEXT.items[0].validity, extra: true } }] }
    expect(validateContextPackage(validV7).status).toBe('pass')
    expect(validateContextPackage({ ...VALID_CONTEXT, createdAt: '2026-02-30T10:00:00Z' }).findings.some((item) => item.code === 'INVALID_DATE_TIME')).toBe(true)
    for (const createdAt of ['2026-08-12T24:00:00Z', '2026-08-12T23:60:00Z', '2026-08-12T23:59:60Z', '2026-08-12T23:59:59+24:00', '2026-08-12T23:59:59+08:60']) {
      expect(validateContextPackage({ ...VALID_CONTEXT, createdAt }).findings.some((item) => item.code === 'INVALID_DATE_TIME'), createdAt).toBe(true)
    }
  })

  it('来源 URI、revision 与脚本嵌入按协议静态检查', () => {
    const bad = validateContextPackage({ ...VALID_CONTEXT, items: [{ ...VALID_CONTEXT.items[0], content: '```js\nglobalThis.probe()\n```', source: { uri: 'javascript:alert(1)', revision: 'latest', locator: 'x' } }] })
    expect(bad.findings.map((item) => item.code)).toEqual(expect.arrayContaining(['UNLOCATABLE_SOURCE', 'UNVERIFIABLE_REVISION', 'EMBEDDED_EXECUTABLE']))
    expect(bad.findings.find((item) => item.code === 'UNVERIFIABLE_REVISION')?.level).toBe('blocked')
    expect(bad.ok).toBe(false)
  })

  it('可执行或未知代码围栏保守阻断，明确的数据围栏仍可使用', () => {
    for (const language of ['node', 'js', 'jsx', 'ts', 'tsx', 'cmd', 'batch', 'c', 'cpp', 'csharp', 'dockerfile', 'makefile', 'future-runtime']) {
      const report = validateContextPackage({ ...VALID_CONTEXT, items: [{ ...VALID_CONTEXT.items[0], content: `\`\`\`${language}\nprint executable\n\`\`\`` }] })
      expect(report.findings.some((item) => item.code === 'EMBEDDED_EXECUTABLE'), language).toBe(true)
      expect(report.ok, language).toBe(false)
    }
    for (const language of ['json', 'yaml', 'toml', 'csv', 'diff', 'mermaid']) {
      const report = validateContextPackage({ ...VALID_CONTEXT, items: [{ ...VALID_CONTEXT.items[0], content: `\`\`\`${language}\nsafe data\n\`\`\`` }] })
      expect(report.findings.some((item) => item.code === 'EMBEDDED_EXECUTABLE'), language).toBe(false)
    }
    for (const content of ['```node\nrun()\n````', '~~~future-runtime\nrun()', '```\nrun()\n```']) {
      const report = validateContextPackage({ ...VALID_CONTEXT, items: [{ ...VALID_CONTEXT.items[0], content }] })
      expect(report.findings.some((item) => item.code === 'EMBEDDED_EXECUTABLE'), content).toBe(true)
    }
  })

  it('URI 必须含可定位的 host、file path 或合法 URN NID/NSS', () => {
    for (const uri of ['urn:', 'urn:x', 'file:///', 'https:///path', 'javascript:alert(1)']) {
      const report = validateContextPackage({ ...VALID_CONTEXT, items: [{ ...VALID_CONTEXT.items[0], source: { ...VALID_CONTEXT.items[0].source, uri } }] })
      expect(report.findings.some((item) => item.code === 'UNLOCATABLE_SOURCE'), uri).toBe(true)
      expect(report.ok, uri).toBe(false)
    }
    for (const uri of ['https://example.test/path', 'http://localhost/source', 'file:///README.md', 'urn:sha256:abcdef1234567890']) {
      const report = validateContextPackage({ ...VALID_CONTEXT, items: [{ ...VALID_CONTEXT.items[0], source: { ...VALID_CONTEXT.items[0].source, uri } }] })
      expect(report.findings.some((item) => item.code === 'UNLOCATABLE_SOURCE'), uri).toBe(false)
    }
  })

  it('latest revision 是强制阻断而非质量警告', () => {
    const report = validateContextPackage({ ...VALID_CONTEXT, items: [{ ...VALID_CONTEXT.items[0], source: { ...VALID_CONTEXT.items[0].source, revision: 'latest' } }] })
    expect(report).toMatchObject({ ok: false, status: 'blocked' })
    expect(report.findings).toContainEqual(expect.objectContaining({ code: 'UNVERIFIABLE_REVISION', level: 'blocked' }))
  })

  it('必需字段和 item 枚举/标签/有效性一次性稳定返回', () => {
    const report = validateContextPackage({ schemaVersion: '0.1', packageId: VALID_CONTEXT.packageId, name: 'x', kind: 'mixed', createdAt: VALID_CONTEXT.createdAt, producer: {}, items: [{ id: '', type: 'other', title: 1, content: '', scope: 'other', source: {}, validity: { observedAt: 'bad', expiresAt: 'bad', confidence: -1 }, sensitivity: 'other', tags: [1] }], warnings: [] })
    expect(report.status).toBe('blocked')
    expect(report.findings.map((item) => item.path)).toEqual(expect.arrayContaining(['/producer/name', '/items/0/type', '/items/0/tags', '/items/0/validity/expiresAt']))
  })

  it('密钥与嵌入脚本阻断，报告不含原值', () => {
    const secret = providerStyleTestSecret()
    const report = validateContextPackage({ ...VALID_CONTEXT, items: [{ ...VALID_CONTEXT.items[0], content: `${secret}\n\n\`\`\`bash\necho unsafe\n\`\`\`` }] })
    expect(report.findings.map((item) => item.code)).toEqual(expect.arrayContaining(['PLAINTEXT_SECRET', 'EMBEDDED_EXECUTABLE']))
    expect(JSON.stringify(report)).not.toContain(secret)
  })

  it('不会执行或请求 source 引用', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const probe = vi.fn()
    ;(globalThis as typeof globalThis & { probe?: () => void }).probe = probe
    validateContextPackage({ ...VALID_CONTEXT, items: [{ ...VALID_CONTEXT.items[0], source: { uri: 'https://example.invalid/script.sh', revision: 'abc', locator: 'all' }, content: 'globalThis.probe()' }] })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(probe).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
    delete (globalThis as typeof globalThis & { probe?: () => void }).probe
  })
})

describe('精确 tokenizer', () => {
  it('与官方 tiktoken 固定 Token ID 一致', () => {
    expect(encodeExact('hello world', 'cl100k_base')).toEqual([15339, 1917])
    expect(encodeExact('お誕生日おめでとう', 'cl100k_base')).toEqual([33334, 45918, 243, 21990, 9080, 33334, 62004, 16556, 78699])
    expect(encodeExact('お誕生日おめでとう', 'o200k_base')).toEqual([8930, 9697, 243, 128225, 8930, 17693, 4344, 48669])
  })

  it('把特殊 token 字面量当普通正文', () => {
    expect(encodeExact('<|endoftext|>', 'cl100k_base')).toEqual([27, 91, 8862, 728, 428, 91, 29])
    expect(encodeExact('<|endoftext|>', 'o200k_base')).toEqual([27, 91, 419, 1440, 919, 91, 29])
    const result = countExactTokens('<|endoftext|>', 'gpt-4o')
    expect(result.mode).toBe('exact')
    expect(result.tokenizer).toBe('gpt-tokenizer@3.4.0')
  })

  it('模型映射与窗口不混入其他变体', () => {
    expect(TOKEN_PROFILES['gpt-4o']).toMatchObject({ encoding: 'o200k_base', limits: [128000] })
    expect(TOKEN_PROFILES['gpt-4']).toMatchObject({ encoding: 'cl100k_base', limits: [8192] })
  })
})

describe('可扩展脱敏规则', () => {
  const literal: CustomRedactionRule = { schema: 'localkit.redaction-rule/v1', id: 'custom-001', label: '内部工号', enabled: true, priority: 80, matcher: { kind: 'literal', value: 'EMP-001', caseSensitive: true } }
  const mask: CustomRedactionRule = { schema: 'localkit.redaction-rule/v1', id: 'custom-002', label: '批量工号', enabled: true, priority: 70, matcher: { kind: 'mask', value: 'EMP-###' } }

  it('固定文本与简单掩码产生核心固定替换标记', () => {
    expect(validateRedactionRule(literal)).toEqual({ ok: true })
    const result = scanAndRedact('A EMP-001 B EMP-234', [literal, mask])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.redactedText).not.toContain('EMP-001')
    expect(result.redactedText).not.toContain('EMP-234')
    expect(result.redactedText).toContain('[已脱敏:custom-001_1]')
  })

  it('分别拒绝任意正则、replacement、未知字段和重复 ID', () => {
    expect(validateRedactionRule({ ...literal, matcher: { kind: 'regex', value: '(a+)+$' } } as unknown as CustomRedactionRule).ok).toBe(false)
    expect(validateRedactionRule({ ...literal, replacement: '$&' } as unknown as CustomRedactionRule).ok).toBe(false)
    expect(validateRedactionRule({ ...literal, unknown: true } as unknown as CustomRedactionRule).ok).toBe(false)
    expect(scanAndRedact('EMP-001', [literal, literal])).toMatchObject({ ok: false, code: 'INVALID_CUSTOM_RULE' })
  })

  it('安全报告不含匹配值、模式或原始偏移', () => {
    const secret = 'EMP-001'
    const result = scanAndRedact(secret, [literal])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const report = buildSafeRedactionReport(result, '05fdc6ef-17b4-4d92-969e-0d97152377b6')
    const serialized = JSON.stringify(report)
    expect(serialized).not.toContain(secret)
    expect(serialized).not.toContain('start')
    expect(serialized).not.toContain('matcher')
  })

  it('命中超限时不生成部分结果', () => {
    const result = scanAndRedact('x '.repeat(5100), [{ ...literal, matcher: { kind: 'literal', value: 'x', caseSensitive: true } }])
    expect(result).toMatchObject({ ok: false, code: 'HIT_LIMIT_EXCEEDED' })
  })

  it('大量合法命中的报告按规则聚合且可被自身批量入口导入', () => {
    const result = scanAndRedact('EMP-001 '.repeat(5000), [literal])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const report = buildSafeRedactionReport(result, '05fdc6ef-17b4-4d92-969e-0d97152377b6')
    expect(report.findings).toHaveLength(1)
    expect(parseSafeReport(JSON.stringify(report)).ok).toBe(true)
  })

  it('规则数量和输入大小超限时无部分结果', () => {
    expect(scanAndRedact('safe', Array.from({ length: 51 }, (_, index) => ({ ...literal, id: `rule-${index}` })))).toMatchObject({ ok: false, code: 'INVALID_CUSTOM_RULE' })
    expect(scanAndRedact('x'.repeat(1024 * 1024 + 1), [])).toMatchObject({ ok: false, code: 'INPUT_TOO_LARGE' })
  })
})

describe('自定义 Skill 策略', () => {
  it('只接受闭合数据规则并产生附加发现', () => {
    const parsed = parseSkillPolicy(JSON.stringify({ schema: 'localkit.skill-policy/v1', rules: [{ id: 'require-version', level: 'warning', check: { kind: 'frontmatter-required', key: 'version' } }] }))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const report = validateSkill([{ path: 'SKILL.md', content: '---\nname: demo\ndescription: demo\n---\n' }], parsed.policy)
    expect(report.findings.some((item) => item.code === 'CUSTOM_POLICY')).toBe(true)
  })

  it('拒绝 action/script/url/extends 等可执行扩展', () => {
    for (const key of ['action', 'script', 'url', 'extends']) {
      const result = parseSkillPolicy(JSON.stringify({ schema: 'localkit.skill-policy/v1', rules: [], [key]: 'unsafe' }))
      expect(result.ok).toBe(false)
    }
  })

  it('matcher 文本只作为数据，不执行探针', () => {
    const probe = vi.fn()
    ;(globalThis as typeof globalThis & { policyProbe?: () => void }).policyProbe = probe
    const parsed = parseSkillPolicy(JSON.stringify({ schema: 'localkit.skill-policy/v1', rules: [{ id: 'probe', level: 'warning', check: { kind: 'content-contains', value: 'globalThis.policyProbe()' } }] }))
    expect(parsed.ok).toBe(true)
    if (parsed.ok) validateSkill([{ path: 'SKILL.md', content: '---\nname: demo\ndescription: demo\n---\n\nglobalThis.policyProbe()' }], parsed.policy)
    expect(probe).not.toHaveBeenCalled()
    delete (globalThis as typeof globalThis & { policyProbe?: () => void }).policyProbe
  })

  it('标量/null/数组/alias frontmatter 均安全阻断而不抛错', () => {
    const policy = parseSkillPolicy(JSON.stringify({ schema: 'localkit.skill-policy/v1', rules: [{ id: 'require-version', level: 'warning', check: { kind: 'frontmatter-required', key: 'version' } }] }))
    expect(policy.ok).toBe(true)
    if (!policy.ok) return
    for (const body of ['hello', 'null', '[a, b]', '&a [*a,*a,*a,*a,*a,*a,*a,*a,*a,*a,*a,*a]']) {
      expect(() => validateSkill([{ path: 'SKILL.md', content: `---\n${body}\n---\n` }], policy.policy)).not.toThrow()
      expect(validateSkill([{ path: 'SKILL.md', content: `---\n${body}\n---\n` }], policy.policy).status).toBe('blocked')
    }
  })

  it('大量密钥命中仍 fail-closed', () => {
    const report = validateSkill([{ path: 'SKILL.md', content: `---\nname: demo\ndescription: demo\n---\n\n${`${providerStyleTestSecret()} `.repeat(5001)}` }])
    expect(report.status).toBe('blocked')
    expect(report.findings.some((item) => item.code === 'POSSIBLE_SECRET')).toBe(true)
  })

  it('批量对象与文件上限不会静默截断', () => {
    expect(validateSkillBatch([])).toMatchObject({ error: { code: 'EMPTY_SKILL_BATCH' } })
    expect(validateSkillBatch(Array.from({ length: 21 }, (_, index) => ({ label: String(index), files: [] })))).toMatchObject({ error: { code: 'SKILL_BATCH_LIMIT' } })
    expect(validateSkillBatch([{ label: 'many', files: Array.from({ length: 257 }, (_, index) => ({ path: `${index}.md`, content: '' })) }])).toMatchObject({ error: { code: 'FILE_COUNT_LIMIT' } })
  })

  it('自定义策略不能关闭内置危险命令阻断', () => {
    const policy = parseSkillPolicy(JSON.stringify({ schema: 'localkit.skill-policy/v1', rules: [] }))
    expect(policy.ok).toBe(true)
    if (!policy.ok) return
    const report = validateSkill([{ path: 'SKILL.md', content: '---\nname: unsafe\ndescription: unsafe\n---\n\nrm -rf /tmp/example' }], policy.policy)
    expect(report.status).toBe('blocked')
    expect(report.findings.some((item) => item.code === 'DANGER_DELETE')).toBe(true)
  })

  it('安全批量报告剥离文件名和引用名', () => {
    const secret = providerStyleTestSecret()
    const batch = validateSkillBatch([{ label: secret, files: [{ path: `${secret}/SKILL.md`, content: `---\nname: demo\ndescription: demo\n---\n\n[missing](${secret}.md)` }] }])
    expect('error' in batch).toBe(false)
    if ('error' in batch) return
    const report = buildSafeSkillReport(batch.units, '1dbb9246-eac6-4fd9-bb52-c2605ed98f14')
    expect(JSON.stringify(report)).not.toContain(secret)
    expect(report.findings[0].subjectId).toBe('item-001')
  })

  it('50 条策略横跨 256 文件时按安全规则聚合且可被自身入口导入', () => {
    const rules = Array.from({ length: 50 }, (_, index) => ({ id: `policy-${index}`, level: 'warning', check: { kind: 'content-contains', value: 'MATCH' } }))
    const parsed = parseSkillPolicy(JSON.stringify({ schema: 'localkit.skill-policy/v1', rules }))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const files = [{ path: 'SKILL.md', content: '---\nname: demo\ndescription: demo\n---\nMATCH' }, ...Array.from({ length: 255 }, (_, index) => ({ path: `references/${index}.md`, content: 'MATCH' }))]
    const batch = validateSkillBatch([{ label: 'large', files }], parsed.policy)
    expect('error' in batch).toBe(false)
    if ('error' in batch) return
    expect(batch.units[0].report.findings.filter((item) => item.code === 'CUSTOM_POLICY')).toHaveLength(50)
    expect(batch.report.findings).toHaveLength(50)
    expect(parseSafeReport(JSON.stringify(batch.report)).ok).toBe(true)
  })

  it('敏感形态的用户策略 ID 只映射为核心安全 ID', () => {
    const sensitiveId = 'a13800138000'
    const parsed = parseSkillPolicy(JSON.stringify({ schema: 'localkit.skill-policy/v1', rules: [{ id: sensitiveId, level: 'warning', check: { kind: 'content-contains', value: 'MATCH' } }] }))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const batch = validateSkillBatch([{ label: 'demo', files: [{ path: 'SKILL.md', content: '---\nname: demo\ndescription: demo\n---\nMATCH' }] }], parsed.policy)
    expect('error' in batch).toBe(false)
    if ('error' in batch) return
    const serialized = JSON.stringify(batch.report)
    expect(serialized).not.toContain(sensitiveId)
    expect(batch.report.findings[0].ruleId).toBe('policy-001')
    expect(parseSafeReport(serialized).ok).toBe(true)
  })
})

describe('安全报告批量汇总', () => {
  const report = {
    schema: 'localkit.report/v1' as const, reportId: '05fdc6ef-17b4-4d92-969e-0d97152377b6', tool: 'redact' as const, status: 'warning' as const,
    summary: { checkedUnits: 1, blocked: 0, warning: 1, passed: 0 }, findings: [{ level: 'warning' as const, code: 'SENSITIVE_VALUES_REDACTED', ruleId: 'builtin.email', line: 1, column: 1 }], privacy: SAFE_PRIVACY,
  }

  it('合并、去重并准确汇总', () => {
    const merged = mergeSafeReports([JSON.stringify(report), JSON.stringify(report)])
    expect(merged.sources).toEqual({ accepted: 1, rejected: 0, duplicates: 1 })
    expect(merged.byTool.redact).toBe(1)
    expect(merged.byCode.SENSITIVE_VALUES_REDACTED).toBe(1)
  })

  it('拒绝正文型字段、旧报告与畸形 JSON', () => {
    expect(parseSafeReport(JSON.stringify({ ...report, input: 'secret' }))).toMatchObject({ ok: false, code: 'UNSAFE_REPORT_FIELD' })
    expect(parseSafeReport(JSON.stringify({ ...report, schema: 'legacy' }))).toMatchObject({ ok: false, code: 'UNSAFE_LEGACY_REPORT' })
    expect(parseSafeReport('{bad')).toMatchObject({ ok: false, code: 'INVALID_REPORT_JSON' })
  })

  it('拒绝藏在允许字符串字段中的疑似密钥', () => {
    const poisoned = { ...report, findings: [{ ...report.findings[0], ruleId: providerStyleTestSecret() }] }
    expect(parseSafeReport(JSON.stringify(poisoned))).toMatchObject({ ok: false, code: 'POSSIBLE_SECRET_IN_REPORT' })
  })

  it('拒绝语义矛盾，error 报告不会汇总为 pass', () => {
    expect(parseSafeReport(JSON.stringify({ ...report, status: 'pass' }))).toMatchObject({ ok: false, code: 'INCONSISTENT_REPORT_STATUS' })
    const errorReport = { ...report, status: 'error' as const, summary: { checkedUnits: 1, blocked: 0, warning: 0, passed: 1 }, findings: [] }
    const merged = mergeSafeReports([JSON.stringify(errorReport)])
    expect(merged.status).toBe('error')
  })

  it('空批次和超出 100 份都有固定拒绝证据', () => {
    expect(mergeSafeReports([])).toMatchObject({ status: 'error', rejected: [{ code: 'EMPTY_REPORT_BATCH' }] })
    const many = mergeSafeReports(Array.from({ length: 101 }, (_, index) => JSON.stringify({ ...report, reportId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}` })))
    expect(many.rejected.some((item) => item.code === 'REPORT_LIMIT_EXCEEDED')).toBe(true)
  })
})
