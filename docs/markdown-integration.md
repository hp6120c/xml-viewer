# Markdown 兼容方案与 md-reader 参考评估

## 分支约定

- 测试分支：`test/markdown-support`
- 参考项目：https://github.com/Neilooo/md-reader
- 参考版本：`0b0ab58`（`main`，MIT License）
- Markdown 功能完善并完成测试后再合并回正式分支；测试分支不直接触发正式 Release。

## 定位

保留现有 XML 数据库设计查看器的数据模型和功能，在同一个 Tauri 桌面壳中增加 Markdown 文档模式：

- XML：继续使用模块、表、字段、单表编辑、XML 校验和原子写回。
- Markdown：使用文档预览、源码编辑、文档搜索、标题大纲和 Markdown 文件保存。
- 两种文件共享标签页、文件夹打开、会话恢复、缩放、关闭保护、单实例、默认应用设置、GitHub 链接和自动更新。

Markdown 没有模块、数据表、字段等数据库语义，因此不将 XML 专用的“表目录/字段详情/表级编辑”强行映射到 Markdown。

## md-reader 功能拆分

### 可以直接或低成本整合

| md-reader 功能 | 本项目的整合方式 |
| --- | --- |
| CommonMark / GFM 渲染 | 新增 Markdown 渲染管线，与 XML 视图并列 |
| 代码块语法高亮 | 使用轻量高亮库或按需加载 |
| 任务列表、脚注、Emoji、标题锚点 | Markdown 渲染插件 |
| 源码 / 预览模式切换 | 复用当前编辑模式的状态管理 |
| CodeMirror Markdown 编辑 | 将现有 XML 编辑器抽象为按语言切换的编辑器 |
| 查找、替换、跳转行 | CodeMirror 自带能力 |
| 多标签、未保存保护 | 复用当前文档状态和关闭保护 |
| 文件树、文件夹打开 | 扩展现有扫描逻辑到混合文件类型 |
| 单例运行、拖拽打开 | 扩展现有路径分发逻辑 |
| `.md` / `.markdown` 文件关联 | 扩展 Tauri `fileAssociations` |
| 相对链接和相对图片 | 基于当前 Markdown 文件目录解析 |
| YAML Front Matter | 可选读取并展示元数据卡片 |
| 标题大纲 | 新增 Markdown 标题抽取和目录面板 |
| 近期文件、滚动位置 | 在当前会话模型上扩展 |

### 适配后再整合

| md-reader 功能 | 适配工作与边界 |
| --- | --- |
| KaTeX 数学公式 | 可以按需加载；需要增加公式样式、测试和首屏性能控制 |
| Mermaid 图表 | 可以按需加载；需要 SVG 清洗并限制脚本/事件属性 |
| 粘贴图片到 `images/` | 可以复用 Tauri 文件写入能力，但必须把写入范围限制在当前文档目录 |
| 文件变更监听 | 可以集成 Rust `notify`；要避免编辑器修改触发的重复刷新 |
| 跨文件全文搜索 | 可以扩展现有 Rust 扫描；XML 和 Markdown 可采用不同的匹配结果类型 |
| 阅读字号、主题、宽高设置 | 可以做成 Markdown 专属阅读设置，不影响 XML 表格布局 |
| PDF / PNG / HTML 导出 | 技术上可行，但涉及浏览器打印、DOM 快照和资源内嵌，建议作为第二阶段 |
| DOCX 导出 | 依赖 pandoc，建议作为可选外部工具功能，不放入核心安装包 |
| 自定义快捷键 | 可做，但需要先统一当前 XML 和 Markdown 的快捷键分发 |
| 中英文界面 | 与 Markdown 兼容无直接关系，本项目暂时保持现有中文界面 |

### 不建议直接整合

| md-reader 实现 | 原因 |
| --- | --- |
| Vue、Pinia、Vue i18n 组件和状态层 | 本项目是 React，不能直接复用；应按现有 React 状态模型重写 |
| `assetProtocol` 的 `**` 全局放行 | 安全范围过宽；本项目应只允许已打开文档目录内的资源 |
| `.mdx` 作为可执行文档 | MDX 可能包含 JavaScript/React 逻辑，和“安全 Markdown 阅读器”目标不同；最多按普通 Markdown 源码查看 |
| 直接执行 Markdown 中的原始 HTML | 必须经过 DOMPurify 或等价白名单清洗，且过滤器要禁止脚本事件和 `javascript:` URL |
| 24 套 PDF 模板、完整 PDF 主题系统 | 功能量大且不是核心预览能力；应独立评估，避免首版范围失控 |
| md-reader 的 MSI、portable、窗口状态和字体插件整套打包方案 | 本项目已有自己的 NSIS、单实例、updater 和安装路径约定，保持现有发布链路 |
| 直接照搬 md-reader 的全局文件关联注册命令 | 本项目的安装包已经注册 XML；Markdown 关联应统一由 Tauri 安装器和 Windows 用户确认机制管理 |

## 推荐的首个 v2.1.0 范围

1. 增加 Markdown 类型和文件分发，不改变 XML 解析器。
2. 增加 Markdown 预览：CommonMark、GFM、代码高亮、标题锚点、相对链接、相对图片、安全清洗。
3. 增加 Markdown 源码编辑：CodeMirror Markdown、保存、未保存保护、原子写回。
4. 增加标记为 Markdown 的标签页、标题大纲和文档内查找。
5. 扩展文件选择、文件夹扫描、命令行、单实例和 `.md` / `.markdown` 文件关联。
6. 增加 Markdown 测试样本、布局测试、混合 XML/Markdown 标签测试和安装版端到端测试。

暂不放入首版：MDX 执行、DOCX 导出、PDF 模板系统、跨文件全文搜索、复杂快捷键自定义。先确保 Markdown 阅读、编辑、保存和文件关联稳定，再逐项增加。

## 安全约束

- 不把 `assetProtocol` 放行到整个磁盘。
- 不允许 Markdown 原生 HTML 直接执行脚本。
- 外链统一交给系统浏览器。
- 相对路径必须基于当前文件目录解析，并拒绝越出允许目录的资源。
- 保存沿用临时文件、`sync_all` 和原子替换，不绕过现有写回保护。
