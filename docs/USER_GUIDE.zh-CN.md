# LocalKit 用户指南

[English](USER_GUIDE.en.md) · [中文 README](../README.zh-CN.md)

本文覆盖 LocalKit `0.2.0` 的安装、六项工具、PWA/离线激活、下载、隐私验证、清理和排障。

## 1. 克隆与安装

需要：

- Node.js `20.19+`
- npm
- 日常使用需要现代 Chromium、Firefox 或 Safari
- 仓库 E2E 需要 Playwright 对应的 Chromium

```bash
git clone https://github.com/mason2048/localkit-ai-dev-toolbox.git
cd localkit-ai-dev-toolbox
npm ci
```

LocalKit 不需要服务端 API Key、数据库、账号或云模型。

## 2. 启动与停止

开发模式：

```bash
npm run dev
```

打开 Vite 输出的地址，通常是 <http://localhost:5173>。停止时按 `Ctrl+C`。

生产/PWA 预览：

```bash
npm run build
npm run preview
```

打开终端输出的预览地址，停止时按 `Ctrl+C`。Service Worker 和离线检查必须用生产预览；开发模式故意不注册 Service Worker。

## 3. 第一次成功操作

1. 打开 LocalKit。
2. 选择“JSON 格式化”。
3. 点击“载入示例”。
4. 点击“格式化并校验”。
5. 确认出现格式化结果与成功状态。
6. 刷新后再次进入 JSON，确认上次输入已消失。

这只证明一条本地 UI 路径，不等于完整隐私或离线边界已经验证。

## 4. 六项工具

### JSON 格式化

- 粘贴 JSON，运行格式化；无效输入会给出行列诊断。
- 切换到“Context Package v0.1”，可校验必填字段、枚举、时间、来源、revision、重复 ID、嵌入可执行内容与疑似秘密。
- 通过只代表已实现的结构和静态规则通过，不证明来源真实或最新。
- 下载内容取决于当前模式：格式化 JSON 或安全校验报告。

### YAML 转换

- 粘贴 YAML 后格式化，或执行 YAML/JSON 双向转换。
- 解析错误会提供行列信息。
- YAML 只作为数据处理，不实例化类或执行标签。

### Prompt Diff

- 输入修改前和修改后文本。
- 选择行级或词级。
- 查看新增、删除和未变片段。
- 需要时下载机器可读摘要。

### Token 估算

- 近似模式用于快速预算。
- 精确模式支持 `cl100k_base`、`o200k_base`、GPT-4 和 GPT-4o 映射下的普通正文。
- 不包含聊天包装、工具调用、图片、服务端缓存规则或计费附加项。
- 两套 tokenizer 数据都在本地包中，精确计数不会发起网络请求。

### 敏感信息脱敏

- 先运行检测，再预览或下载脱敏正文。
- 内置类别包括供应商形密钥/令牌、邮箱、中国大陆手机/身份证和 IPv4。
- 自定义规则只接受固定文本或简单线性掩码，不接受任意正则或替换代码。
- 超过输入、规则或命中上限时不会生成部分下载。
- 安全报告只有类别与安全 ID，不含原值或原始偏移。

### Skill 静态校验

- 选择一个或多个 Skill 目录。不支持或超限文件会使整次选择失败，不会静默跳过。
- 运行内置结构、引用、可疑命令与秘密检查。
- 可选策略 JSON 只能增加警告或阻断，不能关闭内置规则。
- 批量最多 20 个对象。安全报告汇总只接受 `localkit.report/v1`，并去除源名称、路径与正文。
- LocalKit 不会运行 Skill 中的 Shell、脚本、包管理器、动态导入或网络请求。

## 5. 第一次离线激活

1. 执行 `npm run build` 和 `npm run preview`。
2. 联网打开生产预览。
3. 等待页面与静态资源加载完成。
4. 刷新一次，在开发者工具中确认 Service Worker 已接管页面。
5. 在 Network 面板开启离线。
6. 刷新页面。
7. 用内置示例分别运行六项工具。

Service Worker 只缓存同源 HTML、CSS、JavaScript、Manifest 和 tokenizer 资源。它只清理以 `localkit-` 开头的旧缓存，不会删除其他命名空间。

如果首次加载中断，保持联网、重新加载并等待 Service Worker ready 后再测试离线。

## 6. 安装 PWA

PWA 必须通过 `localhost` 或 HTTPS 使用，`file://` 无法注册 Service Worker。

Chrome/Edge：

1. 打开生产预览或 HTTPS 部署。
2. 等待第一次联网加载完成。
3. 浏览器提供时，点击地址栏安装图标或菜单“安装应用”。
4. 从安装版启动并完成一次工具操作。

Safari 与移动浏览器使用各自的“添加到主屏幕”或安装流程。不同版本的可用性不同，必须在目标设备实测，不能只依据 Manifest 宣称安装通过。

## 7. 下载语义

- 只有用户点击下载按钮后才会产生下载。
- LocalKit 创建浏览器 `Blob`、触发临时本地下载链接，并立即撤销对象 URL。
- 输出不会发送给服务器，也没有应用内下载历史。
- 文件进入浏览器/操作系统下载位置后，不再由 LocalKit 管理。
- 安全报告故意不包含输入正文、匹配原值、原始路径和用户策略 ID。

分享前仍需人工复核格式化、Diff 或脱敏结果；规则式脱敏可能漏掉组织自定义标识。

## 8. 移动端与弱网

两套 tokenizer 使 JavaScript 首包约为 3.3 MB，gzip 后约 1.6 MB。低端 Android 或弱网下：

- 第一次激活使用稳定网络。
- 加载完成前保持页面在前台。
- Service Worker 接管前不要切离线。
- 首次打开精确 Token 工具时预留更多内存。
- 测试 390 px 与真实目标尺寸；桌面通过不等于手机通过。

当前没有延迟下载 tokenizer，因为优先保证首次激活后的离线精确计数。这是明确的性能取舍和剩余风险。

## 9. 验证隐私边界

只用人工构造的唯一标记，不要输入真实私有数据。

1. 打开浏览器开发者工具，清空 Network 列表。
2. 在一个工具输入唯一测试标记。
3. 运行操作；不应出现携带或发送该标记的新 Fetch/XHR。
4. 检查 Application/Storage：
   - Local Storage：没有工具输入
   - Session Storage：没有工具输入
   - IndexedDB：没有输入数据库
   - Cookie：没有工具输入
   - Cache Storage：只有静态应用 URL
5. 刷新，确认编辑器和结果为空。
6. 下载结果，确认预期输出只存在于下载文件。

正常首次打开仍会请求同源静态文件。“操作期间零请求”是指应用加载完成后，运行工具不会把输入发送出去。

## 10. 清理

- 刷新或关闭页面即可清除内存中的输入、结果、自定义规则、策略和最近工具顺序。
- 不再需要的下载文件由浏览器/操作系统删除。
- 重置离线安装时，在浏览器卸载 PWA，并清除此站点的 Service Worker 与 Cache Storage。
- `dist/`、`test-results/`、`playwright-report/`、coverage 与 npm 缓存是可重建且已忽略的产物，LocalKit 不会自动删除。

测试时不要清除其他站点数据或不属于 LocalKit 的缓存命名空间。

## 11. 测试

```bash
npm run check
npm run test:e2e
npm audit
```

`npm run check` 执行单元测试和生产构建。`npm run test:e2e` 会重新构建，在 `127.0.0.1:4185` 启动全新预览并运行 16 条桌面/移动端路径。如果 Playwright 没有 Chromium，需要先安装匹配版本后再运行。

## 12. 常见问题

| 现象 | 检查项 |
|---|---|
| Node 版本错误 | 使用 Node 20.19+，重新执行 `npm ci`。 |
| 空白页 | 检查控制台，并确认使用 Vite URL 而不是 `file://`。 |
| 离线刷新失败 | 先完成一次联网生产加载并等待 Service Worker 接管。 |
| 没有安装入口 | 使用 localhost/HTTPS、生产构建和支持安装的浏览器/平台。 |
| 刷新后输入又出现 | 检查浏览器表单恢复或扩展；LocalKit 不会持久化。 |
| 精确 Token 较慢 | 首次打开会解析内置 tokenizer；在目标设备测内存与 CPU。 |
| Skill 目录被拒绝 | 检查 20 对象、256 文件、单文件 1 MiB、总计 16 MiB 和支持类型。 |
| 脱敏不能下载 | 先解决输入/规则/命中上限；fail-closed 不生成部分结果。 |
| Playwright 无法启动 | 确认匹配的 Chromium 已安装，4185 端口可用。 |

## 13. 已知边界

LocalKit 不是凭据保险箱、恶意代码沙箱、在线 API 代理、供应商精确计费器或团队产品，也不能保证规则式脱敏找到全部敏感值。真人、低端 Android、弱网和不同浏览器 PWA 安装仍属于外部验收。
