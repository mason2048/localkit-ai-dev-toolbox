import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, Braces, Check, CheckCircle2, ChevronDown, ClipboardCopy, Clock3, Code2,
  Columns2, Download, Eraser, FileCode2, FileJson2, FileText, FolderOpen, Menu, Moon,
  Play, Plus, RotateCcw, Settings2, ShieldCheck, Sparkles, Sun, Trash2, Type, Upload, X, XCircle,
} from 'lucide-react'
import { validateContextPackage, type ContextValidationReport } from './core/context-package'
import { compareText, diffSummary, type DiffMode } from './core/diff'
import { downloadText } from './core/download'
import { formatJson } from './core/json'
import { buildSafeRedactionReport, scanAndRedact, validateRedactionRule, type CustomRedactionRule, type RedactionResult } from './core/redact'
import { mergeSafeReports, type BatchReport } from './core/report'
import { parseSkillPolicy, validateSkillBatch, type SkillBatchResult, type SkillBatchUnit, type SkillPolicy, type VirtualFile } from './core/skill'
import { countExactTokens, estimateTokens, TOKEN_PROFILES, type ExactTokenCount, type TokenEstimate, type TokenProfile } from './core/tokens'
import type { FormatResult, ToolId } from './core/types'
import { formatYaml, jsonToYaml, yamlToJson } from './core/yaml'

type ToolDefinition = {
  id: ToolId
  name: string
  short: string
  description: string
  icon: typeof Braces
  action: string
}

const TOOLS: ToolDefinition[] = [
  { id: 'json', name: 'JSON 格式化', short: 'JSON', description: '格式化、校验并精确定位语法问题', icon: Braces, action: '格式化并校验' },
  { id: 'yaml', name: 'YAML 转换', short: 'YAML', description: '格式化 YAML，或在 JSON 与 YAML 间转换', icon: FileText, action: '格式化 YAML' },
  { id: 'diff', name: 'Prompt Diff', short: 'DIFF', description: '比较提示词或上下文的行级与词级变化', icon: Columns2, action: '比较差异' },
  { id: 'tokens', name: 'Token 估算', short: 'TOKEN', description: '快速估算 Token 并检查常见上下文预算', icon: Type, action: '估算 Token' },
  { id: 'redact', name: '敏感信息脱敏', short: 'REDACT', description: '先查看命中类别，再生成不含原值的副本', icon: ShieldCheck, action: '检测敏感信息' },
  { id: 'skill', name: 'Skill 静态校验', short: 'SKILL', description: '只读检查结构、引用、危险命令与疑似密钥', icon: Code2, action: '运行静态校验' },
]

const EXAMPLES: Record<Exclude<ToolId, 'skill'>, string | [string, string]> = {
  json: `{"name":"LocalKit","version":"0.1.0","features":["json","yaml","diff"]}`,
  yaml: `name: LocalKit\nversion: 0.1.0\nfeatures:\n  - json\n  - yaml\n  - diff\nlocalOnly: true`,
  diff: ['你是一个严谨的代码审查助手。\n优先发现正确性问题。', '你是一个严谨、简洁的代码审查助手。\n优先发现安全性与正确性问题。'],
  tokens: '请根据以下上下文回答问题。\n\nLocalKit 在浏览器本地处理输入，不会把正文发送到服务器。',
  redact: '测试账号：demo@example.com\n联系电话：13800138000\n示例访问令牌：Bearer localkit-example-token-1234567890',
}

const SKILL_EXAMPLE: VirtualFile[] = [
  { path: 'SKILL.md', content: `---\nname: safe-example\ndescription: 一个只读示例 Skill\n---\n\n# 示例\n\n请阅读 [参考说明](references/guide.md)，不要运行脚本。` },
  { path: 'references/guide.md', content: '# 参考说明\n\n此文件仅用于静态检查示例。' },
]

const CONTEXT_EXAMPLE = JSON.stringify({
  schemaVersion: '0.1', packageId: '5b7714a4-70fc-4e8c-a4f1-a8d8e0c9f203', name: 'localkit-example', kind: 'rule',
  createdAt: '2026-08-12T15:00:00Z', producer: { name: 'localkit', version: '0.2.0' },
  items: [{ id: 'local-processing', type: 'instruction', title: '本地处理', content: '输入只在浏览器本地处理。', scope: 'project', source: { uri: 'file:///README.md', revision: 'sha256:3d5a4b08fb48c663fbdff3d2e288cc9d', locator: '安全与隐私边界' }, validity: { observedAt: '2026-08-12T15:00:00Z', expiresAt: null, confidence: 1 }, sensitivity: 'public', tags: ['privacy'] }], warnings: [],
}, null, 2)

const SKILL_BATCH_EXAMPLE: SkillBatchUnit[] = [
  { label: '安全示例', files: SKILL_EXAMPLE },
  { label: '缺少引用', files: [{ path: 'SKILL.md', content: '---\nname: warning-example\ndescription: warning\n---\n\n[缺失说明](references/missing.md)' }] },
  { label: '危险命令', files: [{ path: 'SKILL.md', content: '---\nname: blocked-example\ndescription: blocked\n---\n\n请运行 rm -rf /tmp/example-only' }] },
]

const POLICY_EXAMPLE = JSON.stringify({ schema: 'localkit.skill-policy/v1', rules: [
  { id: 'require-version', level: 'warning', check: { kind: 'frontmatter-required', key: 'version' } },
  { id: 'require-license', level: 'warning', check: { kind: 'required-file', path: 'LICENSE' } },
] }, null, 2)

function useTheme() {
  const [dark, setDark] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false)
  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light' }, [dark])
  return { dark, toggle: () => setDark((value) => !value) }
}

function useMobileViewport() {
  const [mobile, setMobile] = useState(() => window.matchMedia?.('(max-width: 920px)').matches ?? false)
  useEffect(() => {
    const query = window.matchMedia('(max-width: 920px)')
    const update = () => setMobile(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return mobile
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return <button className="icon-button" aria-label={label} title={label} onClick={onClick}>{children}</button>
}

function Header({ dark, menuOpen, menuButtonRef, onTheme, onMenu, onHome }: { dark: boolean; menuOpen: boolean; menuButtonRef: React.RefObject<HTMLButtonElement>; onTheme: () => void; onMenu: () => void; onHome: () => void }) {
  return (
    <header className="topbar">
      <button ref={menuButtonRef} className="menu-button" aria-label="打开工具导航" aria-controls="tool-navigation" aria-expanded={menuOpen} onClick={onMenu}><Menu size={20} /></button>
      <button className="brand" aria-label="返回工具首页" onClick={onHome}><span>LocalKit</span><small>AI 开发工具箱</small></button>
      <div className="local-status"><ShieldCheck size={18} aria-hidden="true" /><span>本地处理 · 输入不会离开设备</span></div>
      <IconButton label={dark ? '切换到浅色模式' : '切换到深色模式'} onClick={onTheme}>{dark ? <Sun size={18} /> : <Moon size={18} />}</IconButton>
    </header>
  )
}

function Sidebar({ active, recent, mobile, open, onClose, onSelect }: { active: ToolId | 'home'; recent: ToolId[]; mobile: boolean; open: boolean; onClose: () => void; onSelect: (id: ToolId) => void }) {
  const asideRef = useRef<HTMLElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (mobile && open) closeButtonRef.current?.focus()
  }, [mobile, open])
  function handleKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (!mobile || !open) return
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
    if (event.key !== 'Tab') return
    const focusable = [...(asideRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [])]
    if (!focusable.length) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }
  return (
    <>
      {mobile && open ? <div className="scrim" aria-hidden="true" onClick={onClose} /> : null}
      <aside ref={asideRef} id="tool-navigation" className={`sidebar ${mobile && open ? 'sidebar-open' : ''}`} aria-label="工具导航" aria-hidden={mobile && !open ? true : undefined} {...(mobile && !open ? { inert: '' } : {})} onKeyDown={handleKeyDown}>
        {mobile ? <div className="mobile-nav-title"><span>选择工具</span><button ref={closeButtonRef} className="icon-button" aria-label="关闭导航" title="关闭导航" onClick={onClose}><X size={18} /></button></div> : null}
        <nav>
          {TOOLS.map((tool) => {
            const Icon = tool.icon
            return <button key={tool.id} className={active === tool.id ? 'nav-item active' : 'nav-item'} aria-current={active === tool.id ? 'page' : undefined} onClick={() => { onSelect(tool.id); if (mobile) onClose() }}><Icon size={20} /><span>{tool.name}</span></button>
          })}
        </nav>
        <div className="recent">
          <h2>最近使用</h2>
          {recent.length ? recent.map((id, index) => {
            const tool = TOOLS.find((item) => item.id === id)!
            return <button key={`${id}-${index}`} onClick={() => { onSelect(id); if (mobile) onClose() }}><Clock3 size={15} /><span>{tool.name}<small>{index === 0 ? '刚刚' : `${index + 1} 项之前`}</small></span></button>
          }) : <p>运行工具后会显示在这里；仅保留于当前页面。</p>}
        </div>
      </aside>
    </>
  )
}

function Toolbar({ onExample, onClear, onRun, action, disabled = false }: { onExample: () => void; onClear: () => void; onRun: () => void; action: string; disabled?: boolean }) {
  return <div className="toolbar">
    <div className="toolbar-secondary"><button className="button ghost" onClick={onExample}><Sparkles size={16} />载入示例</button><button className="button ghost" onClick={onClear}><Eraser size={16} />清空</button></div>
    <button className="button primary" onClick={onRun} disabled={disabled}><Play size={16} fill="currentColor" />{action}<kbd>⌘ Enter</kbd></button>
  </div>
}

function CopyDownload({ text, filename, copyLabel = '复制结果', downloadLabel = '下载结果', onCopy }: { text: string; filename: string; copyLabel?: string; downloadLabel?: string; onCopy: () => void }) {
  return <div className="result-actions"><button className="button ghost" disabled={!text} onClick={() => { navigator.clipboard.writeText(text); onCopy() }}><ClipboardCopy size={16} />{copyLabel}</button><button className="button ghost" disabled={!text} onClick={() => downloadText(filename, text)}><Download size={16} />{downloadLabel}</button></div>
}

function Editor({ label, value, onChange, placeholder, errorLine }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; errorLine?: number }) {
  const lines = Math.max(12, value.split('\n').length)
  return <div className="editor-shell">
    <label className="sr-only" htmlFor={`editor-${label}`}>{label}</label>
    <div className="line-numbers" aria-hidden="true">{Array.from({ length: lines }, (_, index) => <span key={index} className={errorLine === index + 1 ? 'error-line' : ''}>{index + 1}</span>)}</div>
    <textarea id={`editor-${label}`} spellCheck={false} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
  </div>
}

function EmptyResult({ children = '输入内容并运行，结果会显示在这里。' }: { children?: React.ReactNode }) {
  return <div className="empty-result"><FileCode2 size={30} /><p>{children}</p></div>
}

function FormatTool({ kind, onUsed }: { kind: 'json' | 'yaml'; onUsed: () => void }) {
  const [input, setInput] = useState('')
  const [result, setResult] = useState<FormatResult | null>(null)
  const [contextReport, setContextReport] = useState<ContextValidationReport | null>(null)
  const [jsonMode, setJsonMode] = useState<'format' | 'context'>('format')
  const [yamlMode, setYamlMode] = useState<'format' | 'to-json' | 'from-json'>('format')
  const [copied, setCopied] = useState(false)
  const run = useCallback(() => {
    if (kind === 'json' && jsonMode === 'context') {
      const syntax = formatJson(input)
      if (!syntax.ok) { setResult(syntax); setContextReport(null) }
      else { setResult(null); setContextReport(validateContextPackage(JSON.parse(input) as unknown)) }
    } else {
      const next = kind === 'json' ? formatJson(input) : yamlMode === 'format' ? formatYaml(input) : yamlMode === 'to-json' ? yamlToJson(input) : jsonToYaml(input)
      setResult(next); setContextReport(null)
    }
    onUsed()
  }, [input, jsonMode, kind, onUsed, yamlMode])
  useShortcut(run, !!input.trim())
  const output = contextReport ? JSON.stringify(contextReport, null, 2) : result?.ok ? result.output : result ? JSON.stringify(result.machine, null, 2) : ''
  const extension = kind === 'json' || yamlMode === 'to-json' ? 'json' : 'yaml'
  return <ToolFrame title={kind === 'json' ? 'JSON 格式化' : 'YAML 转换'} description={kind === 'json' ? '格式化、校验并精确定位语法问题' : '格式化 YAML，或在 JSON 与 YAML 间安全转换'}>
    {kind === 'json' && <div className="segmented" aria-label="格式校验选项"><button className={jsonMode === 'format' ? 'selected' : ''} onClick={() => { setJsonMode('format'); setResult(null); setContextReport(null) }}>通用 JSON</button><button className={jsonMode === 'context' ? 'selected' : ''} onClick={() => { setJsonMode('context'); setResult(null); setContextReport(null) }}>Context Package v0.1</button></div>}
    {kind === 'yaml' && <div className="segmented" aria-label="YAML 操作模式">{[['format', '格式化'], ['to-json', 'YAML → JSON'], ['from-json', 'JSON → YAML']].map(([value, label]) => <button key={value} className={yamlMode === value ? 'selected' : ''} onClick={() => { setYamlMode(value as typeof yamlMode); setResult(null) }}>{label}</button>)}</div>}
    <Toolbar action={kind === 'json' ? jsonMode === 'context' ? '校验 Context Package' : '格式化并校验' : yamlMode === 'format' ? '格式化 YAML' : '转换格式'} onExample={() => { setInput(kind === 'json' && jsonMode === 'context' ? CONTEXT_EXAMPLE : EXAMPLES[kind] as string); setResult(null); setContextReport(null) }} onClear={() => { setInput(''); setResult(null); setContextReport(null) }} onRun={run} disabled={!input.trim()} />
    <div className="workspace-grid">
      <section className="input-panel"><PanelHeading label="输入" meta={kind === 'json' ? jsonMode === 'context' ? 'Context Package v0.1' : 'JSON' : yamlMode === 'from-json' ? 'JSON' : 'YAML'} /><Editor label={kind} value={input} onChange={(value) => { setInput(value); setResult(null); setContextReport(null) }} errorLine={result && !result.ok ? result.error.line : undefined} /></section>
      <section className="result-panel"><div className="panel-heading"><div><span>结果</span>{contextReport ? <span className={`status ${contextReport.status}`}>{contextReport.status === 'blocked' ? '需要修复' : contextReport.status === 'warning' ? '通过，有警告' : '校验通过'}</span> : result && <span className={result.ok ? 'status success' : 'status error'}>{result.ok ? <CheckCircle2 size={15} /> : <XCircle size={15} />}{result.ok ? '校验通过' : '需要修复'}</span>}</div><CopyDownload text={output} filename={kind === 'json' && jsonMode === 'context' ? 'localkit-context-package-validation.json' : `localkit-result.${extension}`} downloadLabel={kind === 'json' && jsonMode === 'context' ? '下载校验报告' : `下载 ${extension.toUpperCase()}`} onCopy={() => { setCopied(true); setTimeout(() => setCopied(false), 1200) }} /></div>
        {copied && <div className="toast" role="status"><Check size={15} />已复制</div>}
        {contextReport ? <ContextResult report={contextReport} /> : !result ? <EmptyResult /> : result.ok ? <pre className="code-output">{result.output}</pre> : <div className="diagnostic"><div className="diagnostic-title"><AlertTriangle size={22} /><div><strong>{result.error.message}</strong><span>{result.error.code}</span></div></div><p>{result.error.suggestion}</p><dl><div><dt>行</dt><dd>{result.error.line}</dd></div><div><dt>列</dt><dd>{result.error.column}</dd></div></dl><details><summary>机器可读结果 <ChevronDown size={16} /></summary><pre>{JSON.stringify(result.machine, null, 2)}</pre></details></div>}
      </section>
    </div>
  </ToolFrame>
}

function ContextResult({ report }: { report: ContextValidationReport }) {
  return <div className="context-result"><div className={`context-summary ${report.status}`}>{report.status === 'blocked' ? <XCircle /> : report.status === 'warning' ? <AlertTriangle /> : <CheckCircle2 />}<div><strong>{report.status === 'pass' ? 'Context Package v0.1 静态校验通过' : report.status === 'warning' ? '基础结构通过，存在质量警告' : 'Context Package 需要修复'}</strong><span>{report.summary.checkedItems} 个 ContextItem · {report.summary.blockers} 个阻断 · {report.summary.warnings} 个警告</span></div></div>{report.findings.length ? <div className="context-findings">{report.findings.map((item, index) => <div className={`finding ${item.level}`} key={`${item.code}-${index}`}>{item.level === 'blocked' ? <XCircle /> : <AlertTriangle />}<div><strong>{item.message}</strong><code>{item.path || '/'}</code><span>{item.suggestion}</span></div></div>)}</div> : <div className="context-pass"><CheckCircle2 /><span>基础 Schema 与已实现的静态启发式检查通过；不证明来源真实或内容可信。</span></div>}<details className="machine-details"><summary>机器可读结果 <ChevronDown size={16} /></summary><pre>{JSON.stringify(report, null, 2)}</pre></details></div>
}

function DiffTool({ onUsed }: { onUsed: () => void }) {
  const [before, setBefore] = useState('')
  const [after, setAfter] = useState('')
  const [mode, setMode] = useState<DiffMode>('lines')
  const [ran, setRan] = useState(false)
  const changes = useMemo(() => ran ? compareText(before, after, mode) : [], [after, before, mode, ran])
  const summary = diffSummary(changes)
  const run = useCallback(() => { setRan(true); onUsed() }, [onUsed])
  useShortcut(run, !!before || !!after)
  const machine = JSON.stringify({ ok: true, mode, summary, changes: changes.map(({ value, added, removed, count }) => ({ value, added: !!added, removed: !!removed, count })) }, null, 2)
  return <ToolFrame title="Prompt Diff" description="区分新增、删除与修改词段；内容只在当前页面比较">
    <div className="segmented" aria-label="差异粒度"><button className={mode === 'lines' ? 'selected' : ''} onClick={() => setMode('lines')}>行级</button><button className={mode === 'words' ? 'selected' : ''} onClick={() => setMode('words')}>词级</button></div>
    <Toolbar action="比较差异" onExample={() => { const [a, b] = EXAMPLES.diff as [string, string]; setBefore(a); setAfter(b); setRan(false) }} onClear={() => { setBefore(''); setAfter(''); setRan(false) }} onRun={run} disabled={!before && !after} />
    <div className="diff-inputs"><section><PanelHeading label="原始文本" meta={`${before.length} 字符`} /><Editor label="diff-before" value={before} onChange={(value) => { setBefore(value); setRan(false) }} /></section><section><PanelHeading label="新文本" meta={`${after.length} 字符`} /><Editor label="diff-after" value={after} onChange={(value) => { setAfter(value); setRan(false) }} /></section></div>
    <section className="wide-result"><div className="panel-heading"><div><span>结果</span>{ran && <span className="diff-summary"><b>+{summary.added}</b><i>−{summary.removed}</i></span>}</div><CopyDownload text={machine} filename="localkit-diff.json" onCopy={() => undefined} /></div>{!ran ? <EmptyResult /> : <div className={`diff-view ${mode}`}>{changes.map((part, index) => <span key={index} className={part.added ? 'added' : part.removed ? 'removed' : ''}>{part.value}</span>)}</div>}</section>
  </ToolFrame>
}

function TokenTool({ onUsed }: { onUsed: () => void }) {
  const [input, setInput] = useState('')
  const [mode, setMode] = useState<'approximate' | 'exact'>('approximate')
  const [profile, setProfile] = useState<TokenProfile>('gpt-4o')
  const [result, setResult] = useState<TokenEstimate | ExactTokenCount | null>(null)
  const run = useCallback(() => { setResult(mode === 'exact' ? countExactTokens(input, profile) : estimateTokens(input)); onUsed() }, [input, mode, onUsed, profile])
  useShortcut(run, !!input)
  const machine = result ? JSON.stringify({ ok: true, ...result }, null, 2) : ''
  return <ToolFrame title="Token 估算" description={mode === 'exact' ? '使用本地内置 tokenizer 精确计算编码 Token；不包含聊天包装或服务端计费附加项' : '快速近似估算，并检查常见上下文预算'}>
    <div className="mode-row"><div className="segmented" aria-label="Token 计数模式"><button className={mode === 'approximate' ? 'selected' : ''} onClick={() => { setMode('approximate'); setResult(null) }}>快速估算</button><button className={mode === 'exact' ? 'selected' : ''} onClick={() => { setMode('exact'); setResult(null) }}>精确 tokenizer</button></div>{mode === 'exact' && <label className="select-control"><span>模型 / 编码</span><select aria-label="模型或编码" value={profile} onChange={(event) => { setProfile(event.target.value as TokenProfile); setResult(null) }}>{Object.entries(TOKEN_PROFILES).map(([value, config]) => <option key={value} value={value}>{config.label}</option>)}</select></label>}</div>
    <Toolbar action={mode === 'exact' ? '开始精确计数' : '估算 Token'} onExample={() => { setInput(EXAMPLES.tokens as string); setResult(null) }} onClear={() => { setInput(''); setResult(null) }} onRun={run} disabled={!input} />
    <div className="workspace-grid"><section className="input-panel"><PanelHeading label="输入" meta={`${input.length} 字符`} /><Editor label="tokens" value={input} onChange={(value) => { setInput(value); setResult(null) }} /></section><section className="result-panel"><div className="panel-heading"><div><span>结果</span>{result && <span className="status neutral">{result.mode === 'exact' ? '精确计数' : '近似值'}</span>}</div><CopyDownload text={machine} filename={result?.mode === 'exact' ? 'localkit-exact-token-count.json' : 'localkit-token-estimate.json'} onCopy={() => undefined} /></div>{!result ? <EmptyResult /> : <div className="token-result"><div className="token-total"><span>{result.mode === 'approximate' ? '约' : ''}</span><strong>{result.tokens.toLocaleString()}</strong><span>Tokens</span></div><div className="token-facts"><span>{result.characters} 字符</span>{result.mode === 'approximate' ? <><span>{result.words} 西文词</span><span>{result.cjkCharacters} 中日韩字符</span></> : <><span>{result.encoding}</span><span>{result.tokenizer}</span></>}</div>{result.mode === 'exact' && <div className="token-pieces"><h3>Token ID 预览</h3><div>{result.previewTokenIds.map((id, index) => <span key={`${id}-${index}`} title={`第 ${index + 1} 个 Token`}><code>{id}</code></span>)}</div><p>Token 数量和 ID 精确对应所选编码；字节回退 token 不拆分伪装成独立字符片段。</p></div>}<h3>上下文预算</h3>{result.budgets.map((budget) => <div className="budget" key={budget.limit}><div><strong>{budget.limit >= 1000 ? `${budget.limit / 1000}K` : budget.limit}</strong><span>{budget.level === 'over' ? `超出 ${result.tokens - budget.limit}` : `剩余 ${budget.remaining.toLocaleString()}`}</span></div><div className="meter"><span className={budget.level} style={{ width: `${Math.min(100, budget.percent)}%` }} /></div><em>{budget.percent}%</em></div>)}</div>}</section></div>
  </ToolFrame>
}

function RedactTool({ onUsed }: { onUsed: () => void }) {
  const [input, setInput] = useState('')
  const [result, setResult] = useState<RedactionResult | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [showRules, setShowRules] = useState(false)
  const [rules, setRules] = useState<CustomRedactionRule[]>([])
  const [draft, setDraft] = useState({ label: '', kind: 'literal' as 'literal' | 'mask', value: '', caseSensitive: false })
  const [ruleError, setRuleError] = useState('')
  const run = useCallback(() => { setResult(scanAndRedact(input, rules)); setRevealed(false); onUsed() }, [input, onUsed, rules])
  useShortcut(run, !!input)
  const output = result?.ok ? result.redactedText : ''
  const safeReport = useMemo(() => result?.ok ? buildSafeRedactionReport(result) : null, [result])
  function addRule() {
    const used = new Set(rules.map((rule) => rule.id)); let number = 1; while (used.has(`custom-${String(number).padStart(3, '0')}`)) number += 1
    const next: CustomRedactionRule = { schema: 'localkit.redaction-rule/v1', id: `custom-${String(number).padStart(3, '0')}`, label: draft.label, enabled: true, priority: 40, matcher: draft.kind === 'literal' ? { kind: 'literal', value: draft.value, caseSensitive: draft.caseSensitive } : { kind: 'mask', value: draft.value } }
    const validation = validateRedactionRule(next)
    if (!validation.ok) { setRuleError(validation.message); return }
    setRules((items) => [...items, next]); setDraft({ label: '', kind: 'literal', value: '', caseSensitive: false }); setRuleError(''); setResult(null)
  }
  return <ToolFrame title="敏感信息脱敏" description="先查看命中类别；复制与下载只提供脱敏后的内容">
    <div className="advanced-bar"><button className="button ghost" onClick={() => setShowRules((value) => !value)}><Settings2 size={16} />自定义规则 <span>{rules.length}</span></button><span>内置 6 类规则始终启用 · 自定义规则只保留于当前页面</span></div>
    {showRules && <section className="rule-panel"><div className="rule-list"><h3>规则集</h3><div className="builtin-rule"><ShieldCheck size={16} /><span>内置安全规则</span><small>密钥、令牌、邮箱、手机号、身份证号、IP</small></div>{rules.map((rule, index) => <div className="custom-rule" key={rule.id}><button role="switch" aria-checked={rule.enabled} className={rule.enabled ? 'toggle on' : 'toggle'} aria-label={`启用 ${rule.label}`} onClick={() => { setRules((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, enabled: !item.enabled } : item)); setResult(null) }}><span /></button><div><strong>{rule.label}</strong><small>{rule.matcher.kind === 'literal' ? '固定文本' : '简单掩码'} · {rule.id}</small></div><IconButton label={`删除 ${rule.label}`} onClick={() => { setRules((items) => items.filter((_, itemIndex) => itemIndex !== index)); setResult(null) }}><Trash2 size={15} /></IconButton></div>)}</div><div className="rule-form"><h3>添加自定义规则</h3><label><span>规则名称</span><input aria-label="规则名称" value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} placeholder="例如：内部工号" /></label><label><span>匹配方式</span><select aria-label="匹配方式" value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as 'literal' | 'mask' })}><option value="literal">固定文本</option><option value="mask">简单掩码</option></select></label><label><span>{draft.kind === 'literal' ? '固定文本' : '简单掩码'}</span><input aria-label="匹配内容" value={draft.value} onChange={(event) => setDraft({ ...draft, value: event.target.value })} placeholder={draft.kind === 'literal' ? '例如：EMP-001' : '例如：EMP-#####'} /></label>{draft.kind === 'literal' && <label className="check-row"><input type="checkbox" checked={draft.caseSensitive} onChange={(event) => setDraft({ ...draft, caseSensitive: event.target.checked })} />区分大小写</label>}{ruleError && <p className="form-error" role="alert">{ruleError}</p>}<button className="button primary compact" onClick={addRule}><Plus size={15} />保存并启用</button><p>简单掩码占位符：# 数字、A 大写、a 小写、? 字母或数字。不执行任意正则。</p></div></section>}
    <Toolbar action="检测敏感信息" onExample={() => { setInput(EXAMPLES.redact as string); setResult(null) }} onClear={() => { setInput(''); setResult(null) }} onRun={run} disabled={!input} />
    <div className="workspace-grid"><section className="input-panel"><PanelHeading label="输入" meta="不会记录" /><Editor label="redact" value={input} onChange={(value) => { setInput(value); setResult(null) }} /></section><section className="result-panel"><div className="panel-heading"><div><span>脱敏预览</span>{result && <span className={result.ok ? result.hits.length ? 'status warning' : 'status success' : 'status error'}>{result.ok ? result.hits.length ? `${result.hits.length} 项命中` : '未发现' : '未生成结果'}</span>}</div><div className="result-actions"><CopyDownload text={output} filename="localkit-redacted.txt" copyLabel="复制脱敏文本" downloadLabel="下载脱敏文本" onCopy={() => undefined} />{safeReport && <button className="button ghost" onClick={() => downloadText('localkit-redaction-report.json', JSON.stringify(safeReport, null, 2), 'application/json')}><Download size={16} />安全报告</button>}</div></div>{!result ? <EmptyResult>运行后会先显示命中类别，不展示敏感原值。</EmptyResult> : !result.ok ? <div className="diagnostic"><div className="diagnostic-title"><XCircle size={22} /><div><strong>{result.message}</strong><span>{result.code}</span></div></div><p>已禁止复制和下载部分脱敏结果，请调整输入或规则后重试。</p></div> : <div className="redact-result"><div className="hit-summary">{Object.entries(result.summary).map(([category, count]) => <span key={category}><ShieldCheck size={15} />{category}<b>{count}</b></span>)}</div>{result.hits.length > 0 && <button className="preview-toggle" onClick={() => setRevealed((value) => !value)}>{revealed ? '隐藏脱敏结果' : '预览脱敏结果'}<ChevronDown size={16} /></button>}{revealed && <pre className="code-output safe-output">{output}</pre>}<p className="safe-note"><ShieldCheck size={16} />正文导出只含固定替换标记；安全报告不含原值、规则内容或原始位置偏移。</p></div>}</section></div>
  </ToolFrame>
}

function SkillTool({ onUsed }: { onUsed: () => void }) {
  const [mode, setMode] = useState<'validate' | 'reports'>('validate')
  const [units, setUnits] = useState<SkillBatchUnit[]>([])
  const [batch, setBatch] = useState<SkillBatchResult | null>(null)
  const [policyText, setPolicyText] = useState('')
  const [policy, setPolicy] = useState<SkillPolicy | null>(null)
  const [policyState, setPolicyState] = useState<{ code: string; message: string } | null>(null)
  const [showPolicy, setShowPolicy] = useState(false)
  const [reportInputs, setReportInputs] = useState<string[]>([])
  const [mergedReport, setMergedReport] = useState<BatchReport | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const reportInputRef = useRef<HTMLInputElement>(null)
  const canRun = mode === 'validate' ? units.length > 0 && units.length <= 20 && (!policyText || !!policy) : reportInputs.length > 0
  const run = useCallback(() => {
    if (mode === 'validate') {
      if (!units.length || units.length > 20 || (!!policyText && !policy)) return
      const result = validateSkillBatch(units, policy ?? undefined)
      if ('error' in result) { setPolicyState(result.error); setBatch(null); return }
      setBatch(result)
    } else {
      if (!reportInputs.length) return
      setMergedReport(mergeSafeReports(reportInputs))
    }
    onUsed()
  }, [mode, onUsed, policy, policyText, reportInputs, units])
  useShortcut(run, canRun)
  async function pick(event: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? [])
    if (picked.length > 256) { setPolicyState({ code: 'FILE_COUNT_LIMIT', message: '所选目录超过 256 个文件，未执行部分读取。' }); event.target.value = ''; return }
    const unsupported = picked.filter((file) => !/\.(md|txt|json|ya?ml|js|jsx|ts|tsx|py|sh|zsh|bash)$/i.test(file.name))
    if (unsupported.length) { setPolicyState({ code: 'UNSUPPORTED_FILE', message: '目录含不支持或可能为二进制的文件；为避免漏检，已整体拒绝。' }); event.target.value = ''; return }
    if (picked.some((file) => file.size > 1024 * 1024)) { setPolicyState({ code: 'FILE_SIZE_LIMIT', message: '目录含超过 1 MiB 的文件；为避免漏检，已整体拒绝。' }); event.target.value = ''; return }
    const existingFiles = units.reduce((sum, unit) => sum + unit.files.length, 0)
    const existingBytes = units.reduce((sum, unit) => sum + unit.files.reduce((fileSum, file) => fileSum + new TextEncoder().encode(file.content).byteLength, 0), 0)
    if (existingFiles + picked.length > 256) { setPolicyState({ code: 'FILE_COUNT_LIMIT', message: '全部对象合计超过 256 个文本文件，未读取新目录。' }); event.target.value = ''; return }
    if (existingBytes + picked.reduce((sum, file) => sum + file.size, 0) > 16 * 1024 * 1024) { setPolicyState({ code: 'SKILL_BATCH_TOO_LARGE', message: '全部对象文本总量超过 16 MiB，未读取新目录。' }); event.target.value = ''; return }
    if (units.length >= 20) { setPolicyState({ code: 'SKILL_BATCH_LIMIT', message: 'Skill 对象已达到 20 个上限。' }); event.target.value = ''; return }
    const readable = picked
    const files = await Promise.all(readable.map(async (file) => ({ path: file.webkitRelativePath || file.name, content: await file.text() })))
    const rootName = readable[0]?.webkitRelativePath.split('/')[0] || `Skill ${units.length + 1}`
    setUnits((items) => [...items, { label: rootName, files }]); setBatch(null); setPolicyState(null); event.target.value = ''
  }
  async function pickReports(event: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? [])
    if (picked.length > 100 || picked.some((file) => file.size > 256 * 1024) || picked.some((file) => !/\.json$/i.test(file.name)) || picked.reduce((sum, file) => sum + file.size, 0) > 10 * 1024 * 1024) {
      setReportInputs([]); setMergedReport(null); setPolicyState({ code: 'REPORT_SELECTION_REJECTED', message: '报告数量、类型或大小超过安全上限；未读取部分报告。' }); event.target.value = ''; return
    }
    setReportInputs(await Promise.all(picked.map((file) => file.text()))); setMergedReport(null); setPolicyState(null); event.target.value = ''
  }
  function applyPolicy() {
    const parsed = parseSkillPolicy(policyText)
    if (!parsed.ok) { setPolicy(null); setPolicyState({ code: parsed.code, message: parsed.message }); return }
    setPolicy(parsed.policy); setPolicyState(null); setBatch(null)
  }
  const machine = batch ? JSON.stringify(batch.report, null, 2) : mergedReport ? JSON.stringify(mergedReport, null, 2) : ''
  return <ToolFrame title="Skill 静态校验" description="只读文本文件，不运行任何 Skill 脚本或仓库指令">
    <input ref={inputRef} className="sr-only" type="file" multiple {...({ webkitdirectory: '', directory: '' } as object)} onChange={pick} />
    <input ref={reportInputRef} className="sr-only" type="file" accept="application/json,.json" multiple onChange={pickReports} />
    <div className="segmented" aria-label="Skill 工具模式"><button className={mode === 'validate' ? 'selected' : ''} onClick={() => { setMode('validate'); setMergedReport(null) }}>静态校验</button><button className={mode === 'reports' ? 'selected' : ''} onClick={() => { setMode('reports'); setBatch(null) }}>批量报告</button></div>
    <div className="skill-boundary"><ShieldCheck size={18} /><div><strong>静态、只读、零执行</strong><span>仅在浏览器中读取所选文本文件；不读取二进制文件、不上传、不执行脚本。</span></div></div>
    {mode === 'validate' ? <>
      <div className="skill-toolbar"><div><button className="button ghost" onClick={() => inputRef.current?.click()}><FolderOpen size={16} />添加 Skill 目录</button><button className="button ghost" onClick={() => { setUnits(SKILL_BATCH_EXAMPLE); setBatch(null); setPolicyState(null) }}><Sparkles size={16} />载入验收示例</button><button className="button ghost" onClick={() => { setShowPolicy((value) => !value) }}><Settings2 size={16} />校验策略 {policy ? '1' : '0'}</button><button className="button ghost" onClick={() => { setUnits([]); setBatch(null); setPolicy(null); setPolicyText(''); setPolicyState(null) }}><Eraser size={16} />清空</button></div><button className="button primary" disabled={!canRun} onClick={run}><Play size={16} fill="currentColor" />{units.length > 1 ? '批量静态校验' : '运行静态校验'}<kbd>⌘ Enter</kbd></button></div>
      {showPolicy && <section className="policy-panel"><div><h3>自定义校验策略</h3><p>内置危险命令、疑似密钥和基础 frontmatter 检查始终启用，自定义策略只能增加阻断或警告。</p></div><textarea aria-label="Skill 策略 JSON" spellCheck={false} value={policyText} onChange={(event) => { setPolicyText(event.target.value); setPolicy(null); setPolicyState(null); setBatch(null) }} placeholder={POLICY_EXAMPLE} /><div className="policy-actions"><button className="button ghost" onClick={() => { setPolicyText(POLICY_EXAMPLE); setPolicy(null); setPolicyState(null) }}><Sparkles size={15} />载入策略示例</button><button className="button primary compact" disabled={!policyText.trim()} onClick={applyPolicy}><Check size={15} />验证并应用</button>{policy && <span className="status success">{policy.rules.length} 条规则已应用</span>}</div></section>}
      {policyState && <p className="form-error" role="alert">{policyState.message} · {policyState.code}</p>}
      <div className="workspace-grid skill-workspace"><section className="input-panel"><PanelHeading label="批量对象" meta={`${units.length} 个`} />{units.length ? <ul className="batch-unit-list">{units.map((unit, index) => <li key={`${unit.label}-${index}`}><FileText size={17} /><div><strong>{unit.label}</strong><span>{unit.files.length} 个文本文件</span></div><IconButton label={`移除 ${unit.label}`} onClick={() => { setUnits((items) => items.filter((_, itemIndex) => itemIndex !== index)); setBatch(null) }}><X size={15} /></IconButton></li>)}</ul> : <button className="drop-zone" onClick={() => inputRef.current?.click()}><Upload size={28} /><strong>添加一个或多个 Skill 目录</strong><span>每次选择一个目录；最多 20 个对象、256 文件、16 MiB 文本</span></button>}</section><section className="result-panel"><div className="panel-heading"><div><span>校验结果</span>{batch && <span className={`status ${batch.report.status}`}>{batch.report.status === 'blocked' ? '阻断' : batch.report.status === 'warning' ? '警告' : '通过'}</span>}</div><CopyDownload text={machine} filename="localkit-skill-safe-report.json" downloadLabel="下载安全报告" onCopy={() => undefined} /></div>{!batch ? <EmptyResult /> : <SkillBatchView batch={batch} />}</section></div>
    </> : <>
      <div className="skill-toolbar"><div><button className="button ghost" onClick={() => reportInputRef.current?.click()}><FolderOpen size={16} />选择安全报告</button><button className="button ghost" onClick={() => { setReportInputs([]); setMergedReport(null); setPolicyState(null) }}><Eraser size={16} />清空</button></div><button className="button primary" disabled={!canRun} onClick={run}><Play size={16} fill="currentColor" />汇总安全报告<kbd>⌘ Enter</kbd></button></div>
      {policyState && <p className="form-error" role="alert">{policyState.message} · {policyState.code}</p>}
      <div className="report-privacy"><ShieldCheck size={17} /><span>仅接受 <code>localkit.report/v1</code> 安全报告；含正文、原路径、message 或旧版字段的报告会被拒绝。</span></div>
      <div className="workspace-grid"><section className="input-panel"><PanelHeading label="待汇总报告" meta={`${reportInputs.length} 份`} />{reportInputs.length ? <ul className="file-list">{reportInputs.map((_, index) => <li key={index}><FileJson2 size={17} /><span>报告 {index + 1}</span><small>安全 ID 待校验</small></li>)}</ul> : <button className="drop-zone" onClick={() => reportInputRef.current?.click()}><Upload size={28} /><strong>选择 LocalKit 安全报告</strong><span>最多 100 份，每份 256 KiB；不显示或导出源文件名</span></button>}</section><section className="result-panel"><div className="panel-heading"><div><span>批量汇总</span>{mergedReport && <span className={`status ${mergedReport.status}`}>{mergedReport.status === 'blocked' ? '阻断' : mergedReport.status === 'warning' ? '警告' : mergedReport.status === 'error' ? '含拒绝项' : '通过'}</span>}</div><CopyDownload text={machine} filename="localkit-batch-report.json" downloadLabel="导出批量报告" onCopy={() => undefined} /></div>{!mergedReport ? <EmptyResult /> : <BatchReportView report={mergedReport} />}</section></div>
    </>}
  </ToolFrame>
}

function SkillBatchView({ batch }: { batch: SkillBatchResult }) {
  return <div className="batch-results"><div className="batch-table" role="table" aria-label="Skill 批量校验结果"><div className="batch-row header" role="row"><span>对象</span><span>状态</span><span>阻断</span><span>警告</span><span>文件数</span></div>{batch.units.map((unit) => { const blocked = unit.report.findings.filter((item) => item.level === 'blocked').length; const warning = unit.report.findings.filter((item) => item.level === 'warning').length; return <details key={unit.subjectId}><summary className="batch-row"><span>{unit.label}</span><span className={`status ${unit.report.status}`}>{unit.report.status === 'blocked' ? '阻断' : unit.report.status === 'warning' ? '警告' : '通过'}</span><span>{blocked}</span><span>{warning}</span><span>{unit.report.checkedFiles}</span></summary><div className="finding-list">{unit.report.findings.map((finding, index) => <div className={`finding ${finding.level}`} key={`${finding.code}-${index}`}>{finding.level === 'blocked' ? <XCircle /> : finding.level === 'warning' ? <AlertTriangle /> : <CheckCircle2 />}<div><strong>{finding.message}</strong><span>{finding.code}{finding.file ? ` · ${finding.file}` : ''}{finding.line ? `:${finding.line}` : ''}</span></div></div>)}</div></details> })}</div><p className="safe-note"><ShieldCheck size={16} />下载报告使用安全对象 ID，不包含文件内容、原始路径和疑似密钥值。</p></div>
}

function BatchReportView({ report }: { report: BatchReport }) {
  return <div className="batch-report-view"><div className="report-totals"><div><strong>{report.sources.accepted}</strong><span>已接受</span></div><div><strong>{report.sources.rejected}</strong><span>已拒绝</span></div><div><strong>{report.sources.duplicates}</strong><span>重复</span></div></div><h3>按工具</h3><div className="report-bars"><span>脱敏报告 <b>{report.byTool.redact}</b></span><span>Skill 报告 <b>{report.byTool.skill}</b></span></div>{report.rejected.length > 0 && <><h3>拒绝项</h3><div className="rejected-list">{report.rejected.map((item) => <span key={item.sourceIndex}>报告 {item.sourceIndex}<code>{item.code}</code></span>)}</div></>}<p className="safe-note"><ShieldCheck size={16} />批量输出经过白名单投影，不包含源文件名、正文、原路径或匹配值。</p></div>
}

function PanelHeading({ label, meta }: { label: string; meta: string }) { return <div className="panel-heading"><div><span>{label}</span></div><small>{meta}</small></div> }
function ToolFrame({ title, description, children }: { title: string; description: string; children: React.ReactNode }) { return <main className="tool"><div className="tool-title"><div><h1>{title}</h1><p>{description}</p></div><span className="offline-label"><ShieldCheck size={15} />离线可用</span></div>{children}</main> }

function Home({ recent, onSelect }: { recent: ToolId[]; onSelect: (id: ToolId) => void }) {
  return <main className="home">
    <section className="home-intro"><div><h1>选择一个工具，立即开始</h1><p>六项高频检查都在浏览器本机完成，无需登录，也不会保存输入正文。</p></div><div className="home-privacy"><ShieldCheck size={20} /><div><strong>完全本地处理</strong><span>零上传 · 零正文持久化</span></div></div></section>
    <section aria-labelledby="all-tools-heading"><div className="section-heading"><h2 id="all-tools-heading">全部工具</h2><span>6 项 · 均可离线</span></div><div className="tool-cards">{TOOLS.map((tool) => { const Icon = tool.icon; return <button className="tool-card" key={tool.id} onClick={() => onSelect(tool.id)}><span className="tool-card-icon"><Icon size={23} /></span><span className="tool-card-copy"><strong>{tool.name}</strong><small>{tool.description}</small></span></button> })}</div></section>
    <section className="home-recent" aria-labelledby="recent-heading"><div className="section-heading"><h2 id="recent-heading">最近使用</h2><span>只保留于当前页面</span></div>{recent.length ? <div className="recent-row">{recent.map((id, index) => { const tool = TOOLS.find((item) => item.id === id)!; const Icon = tool.icon; return <button key={id} onClick={() => onSelect(id)}><Icon size={17} /><span>{tool.name}</span><small>{index === 0 ? '刚刚' : `${index + 1} 项之前`}</small></button> })}</div> : <div className="home-empty"><Clock3 size={20} /><span>运行工具后，这里只显示工具名称，不显示输入内容。</span></div>}</section>
  </main>
}

function useShortcut(run: () => void, enabled = true) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if (enabled && (event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); run() } }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [enabled, run])
}

export default function App() {
  const [active, setActive] = useState<ToolId | 'home'>('home')
  const [recent, setRecent] = useState<ToolId[]>([])
  const [mobileNav, setMobileNav] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const mobileViewport = useMobileViewport()
  const { dark, toggle } = useTheme()
  const closeMobileNav = useCallback(() => {
    menuButtonRef.current?.focus()
    setMobileNav(false)
  }, [])
  useEffect(() => { if (!mobileViewport) setMobileNav(false) }, [mobileViewport])
  const markUsed = useCallback(() => { if (active !== 'home') setRecent((items) => [active, ...items.filter((id) => id !== active)].slice(0, 6)) }, [active])
  const content = active === 'home' ? <Home recent={recent} onSelect={setActive} /> : active === 'json' ? <FormatTool kind="json" onUsed={markUsed} /> : active === 'yaml' ? <FormatTool kind="yaml" onUsed={markUsed} /> : active === 'diff' ? <DiffTool onUsed={markUsed} /> : active === 'tokens' ? <TokenTool onUsed={markUsed} /> : active === 'redact' ? <RedactTool onUsed={markUsed} /> : <SkillTool onUsed={markUsed} />
  return <div className="app-shell"><Header dark={dark} menuOpen={mobileViewport && mobileNav} menuButtonRef={menuButtonRef} onTheme={toggle} onMenu={() => setMobileNav(true)} onHome={() => setActive('home')} /><div className="app-body"><Sidebar active={active} recent={recent} mobile={mobileViewport} open={mobileViewport && mobileNav} onClose={closeMobileNav} onSelect={setActive} />{content}</div><footer><span>完全离线运行</span><span>不记录正文</span><span>下载由浏览器本地生成</span></footer></div>
}
