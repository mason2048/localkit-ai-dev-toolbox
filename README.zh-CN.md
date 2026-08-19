# LocalKit · AI 开发工具箱

[English](README.md) · [中文用户指南](docs/USER_GUIDE.zh-CN.md) · [English user guide](docs/USER_GUIDE.en.md)

LocalKit 是一个本地优先、可离线运行的 PWA，集成六项实用 AI 开发工具。它没有业务后端、登录、遥测、分析或云端 AI 依赖。除非用户主动下载文件，否则输入和结果只存在于当前浏览器内存。

当前版本：`0.2.0`。

## 六项工具

| 工具 | 主要能力 | 本地下载 |
|---|---|---|
| JSON 格式化 | 格式化 JSON；校验 Context Package v0.1 结构与静态安全边界 | JSON / 安全校验报告 |
| YAML 转换 | 格式化、校验 YAML；JSON ↔ YAML | JSON 或 YAML |
| Prompt Diff | 行级或词级新增、删除与未变内容 | JSON |
| Token 估算 | 近似预算；精确计算 `cl100k_base` / `o200k_base` 正文 Token | JSON |
| 敏感信息脱敏 | 内置类型与安全的固定文本/简单掩码规则 | 脱敏 TXT / 安全报告 |
| Skill 静态校验 | 检查结构、引用、可疑命令、策略和批量对象 | 安全报告 / 汇总报告 |

静态校验不等于恶意软件分析、来源真实性验证，也不保证 Skill 可以安全执行。

## 快速开始

需要 Node.js `20.19+` 与 npm。

```bash
git clone https://github.com/mason2048/localkit-ai-dev-toolbox.git
cd localkit-ai-dev-toolbox
npm ci
npm run dev
```

打开 Vite 输出的本地地址，通常是 <http://localhost:5173>。第一次使用建议进入“JSON 格式化”，载入示例后运行。停止时按 `Ctrl+C`。

生产预览：

```bash
npm run build
npm run preview
```

PWA 与离线验收必须使用生产预览；开发服务器故意不注册 Service Worker。

## 第一次离线激活

1. 启动生产预览，在联网状态打开页面。
2. 等待首次资源加载完成。
3. 刷新一次，使当前页面被已安装的 Service Worker 接管。
4. 把浏览器切换到离线，再次刷新。
5. 用内置示例分别运行六项工具。

首次联网打开会预缓存 HTML、CSS、JavaScript、Manifest 和两套 tokenizer 数据。完成这次激活前，不能把离线能力视为可用。

## 安装为 PWA

LocalKit 必须通过 `localhost` 或 HTTPS 提供，不能直接用 `file://`。浏览器提供安装入口时，使用地址栏安装按钮或菜单中的“安装应用”。安装版与普通标签页使用同一套本地处理和静态缓存。

不同浏览器和系统的安装入口并不一致；生产构建成功不代表某台设备已经显示并完成安装。

## 隐私与下载语义

- 输入、结果、最近工具顺序、自定义规则与策略只在 React 内存中，刷新或关闭后消失。
- 输入不会写入 Local Storage、Session Storage、IndexedDB、Cookie、分析或日志。
- Cache Storage 只保存离线运行需要的同源静态资源。
- 下载由用户点击后通过浏览器 `Blob` 生成；下载文件已经离开 LocalKit，需要由用户自行管理。
- Skill 文件只按有界文本读取，从不执行。
- 报告使用安全 ID 和白名单投影，不包含正文、匹配原值或原始路径。

详见 [SECURITY.md](SECURITY.md) 与[隐私验证步骤](docs/USER_GUIDE.zh-CN.md#9-验证隐私边界)。

## 验证

```bash
npm run check
npm run test:e2e
npm audit
```

- 单元测试覆盖六工具、协议边界、tokenizer 固定样例、脱敏上限、策略零执行、报告拒绝和 Service Worker 缓存隔离。
- 16 条 Playwright 路径覆盖桌面与移动端、真实下载、刷新清空、操作期间零请求，以及离线刷新后的六工具。
- E2E 使用 `reuseExistingServer: false` 启动新的生产预览。

自动化不能替代真人首次使用、低端 Android、弱网或不同浏览器的 PWA 安装验收。

## 移动端首包风险

两套精确 tokenizer 数据随生产首包提供，确保首次激活后可离线使用。当前 JavaScript 约 3.3 MB，gzip 后约 1.6 MB；低端移动设备可能出现首次交互延迟和内存压力。第一次激活应使用稳定网络，并在 Service Worker 接管前明确标记“离线尚未就绪”。

## 文档

- [中文用户指南](docs/USER_GUIDE.zh-CN.md)
- [English user guide](docs/USER_GUIDE.en.md)
- [P1/P2 验收契约](P1-P2-ACCEPTANCE.md)
- [历史 PRD v0.1](PRD.md)
- [贡献说明](CONTRIBUTING.md)

## 安全问题

请使用 [GitHub Private Vulnerability Reporting](https://github.com/mason2048/localkit-ai-dev-toolbox/security/advisories/new)，不要提交公开 Issue，也不要附带真实凭据、私有 Prompt、客户数据或专有 Skill。

## 许可证

Apache License 2.0，见 [LICENSE](LICENSE)。
