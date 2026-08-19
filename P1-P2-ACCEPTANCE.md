# LocalKit P1/P2 验收定义

本文件把 PRD 已明确的 P1 与产品 README 已列出的 P2 目标固定为可验证范围。所有能力继续遵守本地优先、零输入持久化、零脚本执行和六工具边界。

## P1

### 示例与清空

- 六个工具均可从空状态载入安全示例。
- 六个工具均可一键清空当前输入和结果。
- 示例、输入与结果刷新后消失。

### Context Package v0.1

- 位于 JSON 工具的 `Context Package v0.1` 模式，不新增第七个工具。
- 校验协议规定的顶层、ContextItem、source、validity、枚举、UUID、时间和 confidence。
- 忽略未知字段以保持向前兼容。
- 静态检查明文密钥、嵌入脚本、重复 item id、不可比较 revision 与时间顺序；不可定位来源、不可比较 revision 和可执行/未知代码围栏均阻断。
- 输出人类可读 findings 和不复制输入正文的机器报告。
- 静态校验通过只证明结构与已实现的启发式规则，不证明来源真实、revision 最新、所有推断都可定位或内容已获业务验收。

## P2

### 精确模型 tokenizer

- 内置 `cl100k_base` 与 `o200k_base`，运行时不下载 ranks。
- 提供 GPT-4 与 GPT-4o 映射及纯编码选择。
- Token ID 固定样例与官方 `tiktoken encode_ordinary` 结果一致。
- 精确结果只针对正文编码，不包含聊天包装、工具调用、图片或服务端计费调整。

### 可扩展脱敏规则

- 用户可在当前页面添加、启用、停用和删除规则。
- 只支持固定文本与线性简单掩码；不接受任意 JavaScript 正则或自定义 replacement。
- 输入 1 MiB、规则 50 条、命中 5000 项为安全上限；超限不产生可下载的部分结果。
- 正文导出使用核心固定替换标记；安全报告按规则聚合，不含原值、规则内容或原始偏移，并可被自身批量入口重新导入。

### 自定义 Skill 策略

- 只接受 `localkit.skill-policy/v1` JSON 数据，不接受脚本、URL 继承或动态插件。
- 支持 `content-contains`、`frontmatter-required`、`frontmatter-equals`、`required-file`。
- 自定义规则只能增加 warning/blocked；不能关闭、覆盖或降级内置安全规则。
- 最多 50 条策略规则、20 个对象、全部对象合计 256 个文本文件、单文件 1 MiB、合计 16 MiB；任一超限整体拒绝，不静默漏检。

### 报告批量处理

- Skill 工具可批量校验最多 20 个对象并生成 `localkit.report/v1` 安全报告。
- 批量报告模式只接受新版安全报告；旧报告或含正文型字段的报告固定拒绝。
- 最多 100 份、每份 256 KiB、合计 10 MiB、5000 findings。
- 聚合结果只做白名单投影，用户规则/策略 ID 映射为核心安全 ID，不导出源文件名、正文、原路径、message 或匹配值。

## 自动化验收定义与当前证据

- 单元测试覆盖协议边界、官方 tokenizer fixtures、规则上限、策略零执行、安全报告拒绝矩阵和 Service Worker 缓存命名空间隔离。
- 浏览器端到端套件定义 P1/P2 可见工作流、实际下载内容、零操作请求、刷新清空、移动侧栏键盘焦点和同一次断网刷新后的六工具真实操作。
- 浏览器套件定义生产预览的全新 Chromium 上下文，从发起首页导航到 JSON 内置示例产生成功结果不超过 30 秒；该技术路径不替代真人首次使用测试。
- 独立只读终验在 06 线程环境、当前工作树执行完整 `npm run test:e2e`：16/16 通过、0 失败（桌面端 14、移动端 2，总耗时 8.2 秒）。Playwright 使用 `reuseExistingServer: false`，未复用旧服务；结束后 `4185` 端口无监听，且终验未产生代码变更。
- 根线程复跑 `npm run check`，4 个测试文件、51/51 测试通过，生产构建通过。
- `npm audit --omit=dev --offline` 返回 `found 0 vulnerabilities`；离线审计只使用本机已有的依赖与审计元数据，不等同于联网实时漏洞审计。
- `npm run build`、`npm test`、`npm run test:e2e` 与 `npm audit` 必须全部通过。
