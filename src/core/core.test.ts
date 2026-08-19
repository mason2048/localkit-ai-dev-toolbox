import { describe, expect, it, vi } from 'vitest'
import { compareText, diffSummary } from './diff'
import { formatJson } from './json'
import { scanAndRedact } from './redact'
import { validateSkill } from './skill'
import { countExactTokens, estimateTokens } from './tokens'
import { formatYaml, jsonToYaml, yamlToJson } from './yaml'

const providerStyleTestSecret = () => ['sk', 'example1234567890abcdef'].join('-')

describe('JSON 工具', () => {
  it('格式化有效 JSON', () => {
    const result = formatJson('{"local":true,"tools":6}')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.output).toContain('\n  "tools": 6\n')
  })

  it('无效 JSON 返回行列、代码和修复建议', () => {
    const result = formatJson('{\n  "name": "LocalKit"\n  "tools": 6\n}')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.line).toBe(3)
      expect(result.error.column).toBeGreaterThan(1)
      expect(result.error.code).toBe('E_JSON_SYNTAX')
      expect(result.error.suggestion.length).toBeGreaterThan(8)
    }
  })
})

describe('YAML 工具', () => {
  it('格式化并双向转换', () => {
    expect(formatYaml('name: LocalKit\ntools: [json, yaml]').ok).toBe(true)
    const toJson = yamlToJson('name: LocalKit\nlocal: true')
    expect(toJson.ok && JSON.parse(toJson.output).local).toBe(true)
    const toYaml = jsonToYaml('{"name":"LocalKit","local":true}')
    expect(toYaml.ok && toYaml.output).toContain('local: true')
  })

  it('无效 YAML 返回准确行列', () => {
    const result = formatYaml('name: LocalKit\nitems:\n  - one\n bad: value')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.line).toBe(4)
      expect(result.error.column).toBeGreaterThan(0)
      expect(result.error.code).toBe('E_YAML_SYNTAX')
    }
  })
})

describe('Prompt Diff', () => {
  it('区分行级新增和删除', () => {
    const summary = diffSummary(compareText('第一行\n旧内容\n', '第一行\n新内容\n', 'lines'))
    expect(summary.added).toBeGreaterThan(0)
    expect(summary.removed).toBeGreaterThan(0)
  })

  it('在词级标出修改词段', () => {
    const changes = compareText('检查正确性', '检查安全性与正确性', 'words')
    expect(changes.some((change) => change.added && change.value.includes('安全性'))).toBe(true)
  })
})

describe('Token 估算', () => {
  it('输出近似值和上下文预算', () => {
    const result = estimateTokens('你好 LocalKit，这是一段 prompt。')
    expect(result.tokens).toBeGreaterThan(0)
    expect(result.budgets).toHaveLength(4)
    expect(result.budgets[0].remaining).toBe(4096 - result.tokens)
  })
})

describe('敏感信息脱敏', () => {
  it('识别假密钥、邮箱和电话，导出不含原值', () => {
    const secrets = [providerStyleTestSecret(), 'demo@example.com', '13800138000']
    const input = secrets.join('\n')
    const result = scanAndRedact(input)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const output = result.redactedText
    expect(result.summary).toMatchObject({ 'API 密钥': 1, '邮箱': 1, '中国大陆手机号': 1 })
    for (const secret of secrets) expect(output).not.toContain(secret)
    expect(output).toContain('[已脱敏:builtin.api-key_1]')
  })
})

describe('Skill 静态校验', () => {
  it('给出通过结果', () => {
    const report = validateSkill([{ path: 'SKILL.md', content: '---\nname: safe\ndescription: safe demo\n---\n\n只读检查。' }])
    expect(report.status).toBe('pass')
    expect(report.findings[0].level).toBe('pass')
  })

  it('缺失引用产生警告', () => {
    const report = validateSkill([{ path: 'SKILL.md', content: '---\nname: demo\ndescription: demo\n---\n\n[说明](references/missing.md)' }])
    expect(report.status).toBe('warning')
    expect(report.findings.some((finding) => finding.code === 'MISSING_REFERENCE')).toBe(true)
  })

  it('危险命令产生阻断且从不执行', () => {
    const executionProbe = vi.fn()
    ;(globalThis as typeof globalThis & { __executionProbe?: () => void }).__executionProbe = executionProbe
    const report = validateSkill([
      { path: 'SKILL.md', content: '---\nname: unsafe\ndescription: unsafe demo\n---\n\n参考 [脚本](scripts/danger.sh)' },
      { path: 'scripts/danger.sh', content: 'rm -rf /tmp/example-only\nnode -e "globalThis.__executionProbe()"' },
    ])
    expect(report.status).toBe('blocked')
    expect(report.findings.some((finding) => finding.code === 'DANGER_DELETE')).toBe(true)
    expect(executionProbe).not.toHaveBeenCalled()
    delete (globalThis as typeof globalThis & { __executionProbe?: () => void }).__executionProbe
  })

  it('疑似密钥阻断且报告不泄露原值', () => {
    const secret = providerStyleTestSecret()
    const report = validateSkill([{ path: 'SKILL.md', content: `---\nname: leaked\ndescription: demo\n---\n\n${secret}` }])
    expect(report.status).toBe('blocked')
    expect(JSON.stringify(report)).not.toContain(secret)
  })
})

describe('六工具离线核心路径', () => {
  it('无需网络即可完成一次真实核心操作', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    try {
      expect(formatJson('{"ok":true}').ok).toBe(true)
      expect(formatYaml('ok: true').ok).toBe(true)
      expect(diffSummary(compareText('before', 'after', 'words')).added).toBeGreaterThan(0)
      expect(countExactTokens('LocalKit 离线', 'gpt-4o').tokens).toBeGreaterThan(0)
      expect(scanAndRedact('demo@example.com').ok).toBe(true)
      expect(validateSkill([{ path: 'SKILL.md', content: '---\nname: offline\ndescription: local only\n---\n' }]).status).toBe('pass')
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
    }
  })
})
