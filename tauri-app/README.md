# XML 数据库设计查看器（Tauri 2）

这是 XML 数据库设计查看器的 **V2.x 桌面版**。当前项目已从旧版 Python/PyQt5 架构迁移到 **Tauri 2 + React + TypeScript + Rust**，XML 预览和表格由 Windows WebView2 中的 Chromium 内核渲染，不再受 `QTextBrowser` 的排版能力限制。

> 软件定位是查看和轻量编辑 SCL Schema XML，不是通用 XML 格式化器。界面会自动识别数据库、模块、子模块、表、字段、主键、外键、索引和备注等结构。

## 技术架构

| 层次 | 技术 | 职责 |
|---|---|---|
| 桌面壳 | Tauri 2 | 窗口、单实例、文件关联、命令行参数、系统设置入口 |
| 前端 | React 18 + TypeScript + Vite | 标签页、模块树、表详情、搜索、编辑器、响应式布局 |
| 渲染 | Windows WebView2 | 使用 Chromium 渲染 HTML/CSS，支持流式宽度和复杂表格 |
| 后端 | Rust | XML 编解码、解析、校验、原子保存、目录扫描 |
| 编辑器 | CodeMirror 6 | XML 语法高亮、搜索和直接编辑 |
| 打包 | Tauri NSIS | 生成 Windows 当前用户安装包并注册 `.xml` 文件关联 |
| 更新 | Tauri Updater v2 | 校验签名并通过 GitHub Release 的 `latest.json` 发布更新 |

核心数据流如下：

1. Tauri 启动时读取命令行中的 `.xml` 路径；
2. Rust 按 BOM 或 XML 声明识别编码，解析出数据库结构；
3. React 在 WebView2 中渲染模块树、总览和字段详情；
4. 编辑时前端把修改后的单表 XML 片段发送给 Rust；
5. Rust 先做完整 XML 校验，再通过同目录临时文件原子替换原文件；
6. 写入成功后重新解析并把最新结构返回前端。

## 主要功能

- 多文件标签页和最近会话恢复；
- 文件夹 XML 批量扫描；
- 模块、子模块和直属表导航；
- 数据表总数、字段总数、模块数统计；
- 表名、字段名、字段备注和枚举值搜索；
- 字段详情、主键/必填标记、外键、索引和备注展示；
- 选中单表后直接编辑，保存前校验并原子写回；
- 保存前 XML 校验、原编码/BOM/换行风格保留、原子写入；
- 有未保存修改时阻止切换、刷新或关闭；
- 窗口尺寸自适应，表格宽度跟随内容区并支持必要时的水平滚动；
- 界面缩放；
- Windows `.xml` 文件关联、双击打开和单实例文件转交。

## 目录结构

```text
xml-viewer/
├─ .github/
│  └─ workflows/
│     └─ tauri-build.yml        # 根目录工作流：签名构建、更新清单和 Release
└─ tauri-app/
   ├─ src/                      # React/TypeScript 前端
   │  ├─ App.tsx               # 主界面和交互状态
   │  ├─ App.css               # 自适应布局和视觉样式
   │  ├─ lib/api.ts            # Tauri invoke/事件封装与浏览器演示模式
   │  └─ lib/xml.ts            # 前端筛选和统计辅助函数
   ├─ src-tauri/
   │  ├─ src/lib.rs            # Tauri 命令、单实例和系统入口
   │  ├─ src/xml.rs            # XML 解析、编码、校验和原子保存
   │  ├─ capabilities/         # Tauri 权限配置
   │  └─ tauri.conf.json       # 窗口、NSIS、文件关联、更新端点和公钥
   ├─ tests/layout-check.mjs   # Playwright 多窗口尺寸布局检查
   └─ package.json
```

## 开发环境

建议使用 Windows 10/11 x64。

### 必需软件

- **Node.js 22 LTS**（最低 Node.js 18）；
- **Rust stable 1.85 或更新版本**。项目使用 Rust 2024 edition；
- **Visual Studio Build Tools**，安装“使用 C++ 的桌面开发”工作负载和 Windows SDK；
- **Microsoft Edge WebView2 Runtime**。Windows 10/11 通常已预装，如缺失可从微软官网安装；
- Git。

Tauri CLI 已作为 npm 开发依赖安装，不需要额外全局安装。NSIS 通常由 Tauri 构建过程自动下载；在受限网络环境中也可以预装 NSIS 并配置环境变量。

### 安装依赖

```powershell
cd tauri-app
npm ci
```

## 本地开发

启动完整的 Tauri 桌面应用：

```powershell
npm run tauri dev
```

该命令会启动 Vite、编译 Rust 后端并打开 WebView2 窗口。开发服务固定使用 `http://localhost:1420`，端口被占用时会直接失败。

只调试前端（浏览器演示模式，带内置演示数据，不访问本地文件）：

```powershell
npm run dev
```

浏览器演示模式不能验证文件关联、命令行打开、真实文件写入和 Windows 默认应用设置，这些能力必须运行 Tauri 桌面版验证。

## 检查与测试

### TypeScript 与前端构建

```powershell
npm run build
```

该命令先执行 `tsc --noEmit`，再生成生产前端资源到 `dist/`。

### Rust 测试

```powershell
cargo test --manifest-path src-tauri/Cargo.toml
```

常规测试覆盖 XML 结构解析、直属表和子模块表、布尔属性以及无效片段校验。仓库还提供需要真实 XML 目录的忽略测试，本地可按需显式运行；真实业务 XML 不应提交到仓库，也不应上传到 CI。

### 一次执行前端和 Rust 检查

```powershell
npm run check
```

### 布局自适应测试

```powershell
npm run build
npm run test:layout
```

布局测试使用 Playwright 驱动本机 Chrome 或 Edge，在以下窗口尺寸检查总览页、字段表、搜索、主键/必填标记和水平溢出：

- 1440 × 900
- 1280 × 800
- 1600 × 1000
- 1100 × 640

测试要求内容区表格铺满可用宽度；只有字段列确实需要时才允许出现表格内部横向滚动。测试同时检查页面本身没有横向溢出，并在输出目录生成总览、表详情和编辑器截图。测试只使用演示数据，不读取真实业务 XML。

真实安装版端到端测试可在开发时临时开启 WebView2 调试端口：

```powershell
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9222'
# 启动已安装版并打开一个测试 XML 副本后，在另一个终端运行：
$env:XML_VIEWER_E2E_FILE='C:\path\to\test-copy.xml'
node tests/end-to-end.mjs
```

该测试会验证搜索、编辑、无效 XML 不落盘、有效 XML 原子写回和原文件恢复。调试端口只应在本地测试时开启，不要用于日常运行。

如果没有安装 Chrome，可安装 Google Chrome，或确认 Edge 位于默认安装目录。布局测试定位的是系统浏览器可执行文件，不是 WebView2 进程。

## 构建 Windows 安装包

```powershell
npm run build:desktop
```

等价命令为：

```powershell
npm run tauri -- build --bundles nsis
```

构建产物位于：

```text
src-tauri/target/release/bundle/nsis/*-setup.exe
src-tauri/target/release/bundle/nsis/*-setup.exe.sig
```

当前 NSIS 配置为 **currentUser** 安装模式，安装时不需要管理员权限，文件关联注册在当前用户范围内。

当设置 `TAURI_SIGNING_PRIVATE_KEY` 后，Tauri 会同时生成 updater 签名文件 `.sig`。GitHub Actions 使用该签名生成并发布 `latest.json`，客户端会根据 `tauri.conf.json` 中的公钥验证更新包。

本地构建 updater 产物时，不要把私钥内容写进命令、脚本或仓库文件。可在当前 PowerShell 会话中临时设置：

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = "<私钥内容或本地私钥路径>"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "<有密码时填写，否则留空>"
npm run build:desktop
```

## Windows 默认 XML 应用：正确预期

Windows 不允许普通桌面程序静默把自己设为默认应用。Tauri 的 `fileAssociations` 配置会：

- 生成并注册本程序的 `.xml` ProgID；
- 让程序出现在“打开方式”和 Windows“默认应用”候选列表中；
- 安装后允许用户通过双击、右键“打开方式”或系统设置选择本程序。

它**不能绕过 Windows 的默认应用确认机制**，也不应该尝试直接修改系统默认关联来冒充用户确认。这是 Windows 平台的安全和用户体验约束，和 Tauri、Electron 或 Qt 无关。

### 设置步骤

推荐从程序工具栏点击“默认应用”按钮。程序会打开：

```text
ms-settings:defaultapps
```

然后在 Windows 中完成确认：

1. 打开“设置 → 应用 → 默认应用”；
2. 选择“按文件类型选择默认应用”；
3. 找到 `.xml`；
4. 选择“XML 数据库设计查看器”；
5. 也可以右键任意 XML 文件，选择“打开方式 → 选择其他应用”，勾选“始终使用此应用打开 .xml 文件”。

Windows 11 不同版本的默认应用页面布局可能略有差异，但都必须在系统 UI 中由用户确认。安装包注册文件关联不代表它已经成为默认应用。

## 双击与命令行打开

Tauri 安装包会在 `tauri.conf.json` 中注册：

```json
{
  "fileAssociations": [
    {
      "ext": ["xml"],
      "name": "XML Database Design",
      "role": "Viewer",
      "mimeType": "application/xml"
    }
  ]
}
```

用户将本程序设为 `.xml` 默认应用后，双击文件即可打开。程序也支持命令行一次传入一个或多个 XML：

```powershell
& "<安装目录>\XML数据库设计查看器.exe" "C:\data\design-a.xml" "D:\specs\design-b.xml"
```

路径包含空格时必须使用双引号。后端只接受实际存在且扩展名为 `.xml` 的文件路径，其他命令行参数会被忽略。

单实例行为如下：

- 程序未运行时，启动参数中的 XML 会被直接打开；
- 程序已经运行时，第二次启动不会创建新进程；
- 新实例收到的 XML 路径通过 `open-xml-files` 事件转交给现有窗口；
- 现有窗口会取消最小化、显示并聚焦；
- 多个路径会按稳定顺序去重后加入标签页。

因此，文件管理器双击、命令行和“打开方式”最终使用同一套文件打开流程。

## 编辑校验与原子保存

编辑模式不是简单地覆盖整份文件。保存流程遵循以下约束：

### 单表编辑

- 编辑器只允许修改当前 `<table>` 片段；
- 保存时必须恰好有一个 `<table>` 根元素；
- 表 ID 必须与当前表一致，防止修改后写错表；
- Rust 将片段合并回原始 XML 的精确字符范围；
- 合并后的完整 XML 必须再次解析成功才能写入。


### 写入策略

- 读取时识别 UTF-8、UTF-16 LE/BE，以及 GBK/GB2312/GB18030/CP936 等声明；
- 保存时尽可能沿用原编码、BOM 和换行风格；
- 在同一目录创建临时文件；
- 写入并 `sync_all` 后再原子替换目标文件；
- 替换后重新读取并解析文件，只有成功才更新界面；
- 任何校验、编码或写入失败都会保留原文件并显示错误；
- 切换表、切换模式、刷新、关闭标签页或关闭窗口时，若存在未保存修改，会要求用户确认。

不建议在程序外同时编辑同一个文件。如果文件已被其他程序修改，应重新打开或刷新后再编辑，以免覆盖外部更改。

## 布局与“铺满窗口”

V2 使用普通 DOM 和 CSS 渲染，不依赖富文本控件：

- 根容器使用 `width: 100%`、`height: 100%` 和 flex 布局；
- 右侧内容区和表详情宽度跟随窗口；
- 表格使用 `width: 100%`、`table-layout: fixed`；
- 长字段内容在单元格内换行，不把整页撑宽；
- 页面本身不允许横向溢出，横向滚动限定在字段表容器；
- 工具栏可以换行，最小窗口尺寸为 1100 × 640；
- 支持界面缩放，但缩放不应改变“内容区铺满”的基本布局要求。

“铺满”不等于强制把所有列压进一屏导致文字不可读。正确的行为是：表格外框铺满内容区；当列数或最小列宽确实无法容纳时，只在表格内部出现水平滚动条。布局测试会检查这一边界。

## GitHub Actions 构建与发布

工作流位置：

```text
.github/workflows/tauri-build.yml
```

这是**仓库根目录**的工作流，GitHub 只会识别这里的 Actions 文件。`tauri-app/.github` 下的同名文件不会被 GitHub 执行，因此本项目不再保留重复的嵌套工作流。

工作流在 `windows-latest` 上执行：

1. 检出代码；
2. 安装 Node.js 22 和 Rust stable；
3. 在 `tauri-app` 工作目录安装前端依赖并缓存 Cargo 构建结果；
4. 检查标签以及四个版本文件是否一致；
5. 检查 updater 公钥、端点和 `createUpdaterArtifacts` 配置；
6. 执行前端构建和 Rust 测试；
7. 使用 Tauri updater 私钥签名 NSIS 安装包；
8. 通过官方 `tauri-apps/tauri-action@v1` 创建 Release，上传 NSIS 安装包、`.sig` 和 `latest.json`；
9. 校验 Release 中确实存在上述资产，并确认 `latest.json` 的 Windows URL 指向本次 Release 的实际安装包。

触发规则：

- 推送 `v*` 或 `V*` 版本标签：构建并发布 Release；
- 手动触发：填写与项目版本一致的版本标签，构建并发布 Release；
- 普通分支提交不会自动发布 Release。

发布前会检查标签格式，以及 `package.json`、`package-lock.json`、`src-tauri/tauri.conf.json` 和 `src-tauri/Cargo.toml` 中的版本是否一致。正式发布示例：

```powershell
git tag v2.0.1
git push origin v2.0.1
```

### GitHub Secrets 配置

在 GitHub 仓库中打开 **Settings → Secrets and variables → Actions → New repository secret**，配置：

| Secret | 是否必需 | 内容 |
|---|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | 必需 | 完整私钥文本内容；不要填写本机文件路径，因为该路径在 Actions Runner 上不存在 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 可选 | 生成私钥时设置的密码；没有密码就不要创建或留空 |
| `GITHUB_TOKEN` | 自动提供 | GitHub Actions 内置令牌，不需要手工创建 |

工作流会把这些 Secret 只注入到签名检查和 Tauri 构建步骤的环境变量中：

```yaml
env:
  TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
```

安全要求：

- **绝不能把私钥、私钥路径下的文件或密码提交到 Git 仓库**；
- 不要把私钥打印到 Actions 日志、Release 说明或 Issue；
- 私钥只保存在可信本机和 GitHub Actions Secret 中，并做好离线备份；
- 公钥可以公开，当前公钥已写入 `src-tauri/tauri.conf.json`；
- 一旦丢失私钥，已经安装旧版本的用户将无法验证后续更新包。

### 首次发布

1. 确认本机 updater 私钥与 `tauri.conf.json` 中的公钥来自同一对密钥；
2. 把私钥完整内容保存到 `TAURI_SIGNING_PRIVATE_KEY`，有密码时再保存 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`；
3. 确认下面四个文件的版本号一致。首次发布当前代码时为 `2.0.1`，后续发布时四个文件必须同步修改：
   - `tauri-app/package.json`
   - `tauri-app/package-lock.json`
   - `tauri-app/src-tauri/Cargo.toml`
   - `tauri-app/src-tauri/tauri.conf.json`
4. 在 `tauri-app` 目录执行 `npm run check`，确认构建和 Rust 测试通过；
5. 提交版本修改并推送；
6. 创建并推送版本标签：

```powershell
git tag v2.0.1
git push origin v2.0.1
```

也可以在 GitHub Actions 页面手动运行 `Build and Release Tauri App`，在 `release_tag` 中填写同一个标签。工作流会失败而不是发布版本不一致的安装包。之后的版本沿用同样流程，只需把标签和四个版本文件一起更新。

Release 完成后应包含：

- `*-setup.exe`：Windows NSIS 安装包；
- `*-setup.exe.sig`：Tauri updater 签名；
- `latest.json`：Tauri v2 更新清单，其中 `windows-x86_64.url` 指向当前 Release 的实际安装包。

客户端更新端点固定为：

```text
https://github.com/hp6120c/xml-viewer/releases/latest/download/latest.json
```

因此发布必须保持为非 draft、非 prerelease，并成为仓库的最新 Release。工作流最后会自动检查最新 Release、三个必需资产以及 `latest.json` 中的下载 URL。

## 已知边界

- Windows 默认应用必须由用户在系统设置中确认；
- 程序不是通用 XML IDE，不提供 XSD 可视化设计或数据库 DDL 生成；
- XML 的 DTD 可以存在，但解析过程不会下载或校验外部 DTD；
- 文件关联注册只覆盖 Windows 安装包；从源码运行时需要手动执行 Tauri 构建或通过“打开方式”选择开发可执行文件；
- 界面编辑范围是单个 <table> 片段；通用 XML 模式当前以查看为主；
- 当前构建使用 Tauri updater 的 minisign 签名，不等于 Windows Authenticode 代码签名；未配置代码签名证书时，首次下载仍可能出现 SmartScreen 提示；
- 自动更新依赖同一把 updater 私钥持续签名；私钥丢失后无法为旧版本用户发布可验证的更新；
- GitHub Release 的公开 `latest.json` 可能受 CDN 缓存影响，刚发布后短时间内的更新检查不保证立即看到新版本。





