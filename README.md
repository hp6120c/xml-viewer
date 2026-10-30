# XML / Markdown 编辑器

当前测试版本为 **V2.1.0**，架构为 **Tauri 2 + React + TypeScript + Rust**，运行在 Windows WebView2/Chromium 上。本版本在 XML 数据库编辑器基础上增加 Markdown 阅读和编辑能力，使用标准 HTML/CSS 自适应布局。

## 目录

- `tauri-app/`：当前主程序源代码，详见 [tauri-app/README.md](tauri-app/README.md)
- `docs/`：图标、旧版文档与历史说明
- `main.py`、`ui/`、`utils/`：旧版 PyQt5 V1.8 源码，仅保留作历史参考，不再作为发布目标
- `.github/workflows/tauri-build.yml`：V2 的 Windows NSIS 构建、签名、发布和 updater 清单校验

## 已实现能力

- SCL Schema XML 多文件标签页、目录树、字段详情和全字段搜索
- 真实目录 21 个 XML / 1173 张表 / 15847 个字段的兼容性测试
- 单表编辑、XML 结构校验、按表序号和 ID 双重定位、原子写回
- 未保存修改切换/关闭保护，编辑期间保存竞态保护
- 通用 XML 回退查看模式（非 SCL 文件不再显示为空目录）
- Markdown 阅读：GFM 表格、任务列表、脚注、代码高亮、YAML Front Matter、标题大纲
- Markdown 源码编辑、未保存保护、原编码/BOM/换行风格保留和原子写回
- Markdown 相对图片安全加载，仅允许读取当前 Markdown 文件目录内的资源
- Markdown 预览中选中文字后可局部修改字号、字体、颜色、高亮、粗体、斜体和下划线
- 新建 Markdown / XML 文件、全屏标签阅读、Markdown 基础阅读样式
- Markdown 基础样式可单独调整左侧大纲的字体、字号和字重
- 自适应窗口布局、缩放、标签页右键菜单
- Windows `.xml` / `.md` / `.markdown` 文件关联、命令行/双击打开、单实例转交
- GitHub 项目链接跳转
- Tauri Updater v2 签名更新与 GitHub Release `latest.json`
- “默认应用设置”会注册 Windows 默认应用候选并打开系统设置；Windows 不允许程序静默绕过用户选择默认应用

## 快速开始

```powershell
cd tauri-app
npm ci
npm run tauri dev
```

完整开发、构建、发布、updater 私钥和 GitHub Secrets 配置请看 [tauri-app/README.md](tauri-app/README.md)。

## 验证

```powershell
cd tauri-app
npm run check
npm run test:layout
```

真实 SCL 目录测试可按 `tauri-app/README.md` 中的说明通过 `XML_VIEWER_TEST_DIR` 运行。

