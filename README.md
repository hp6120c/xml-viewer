# XML 数据库设计查看器

当前主版本为 **V2.0.0**，架构为 **Tauri 2 + React + TypeScript + Rust**，运行在 Windows WebView2/Chromium 上。新的 UI 使用标准 HTML/CSS 自适应布局，右侧表目录和字段表会铺满内容区，并支持窗口缩放。

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
- 自适应窗口布局、缩放、标签页右键菜单
- Windows `.xml` 文件关联、命令行/双击打开、单实例转交
- GitHub 项目链接跳转
- Tauri Updater v2 签名更新与 GitHub Release `latest.json`
- “设为默认”按钮打开 Windows 默认应用设置；Windows 不允许程序静默绕过用户选择默认应用

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
