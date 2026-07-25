# XML 数据库设计查看器

一个基于 PyQt5 开发的桌面应用程序，用于方便地浏览和编辑 SCL Schema 格式的 XML 数据库设计文件。支持多标签页、拖拽导入、编辑模式、搜索过滤和会话记忆等功能。

## 功能特性

### 核心功能

| 功能 | 说明 |
|------|------|
| **多标签页浏览** | 每个 XML 文件独立一个标签页，支持同时查看多个文件 |
| **树形导航** | 左侧按模块 → 子模块 → 表 的层级结构展示，点击直接跳转 |
| **表目录概览** | 右侧 HTML 渲染的表目录，包含表名、中文名、字段数、类型等信息 |
| **字段详情** | 点击表名查看完整字段列表，包含主键、类型、非空、默认值等 |
| **搜索过滤** | 支持按表名/字段名实时搜索过滤 |
| **拖拽导入** | 直接拖拽 XML 文件或文件夹到窗口即可打开 |
| **编辑模式** | 可切换到编辑模式直接修改 XML 源文件，支持光标同步定位 |
| **会话记忆** | 关闭时自动保存打开的文件列表和窗口位置，下次启动自动恢复 |

### 界面设计

- 现代化 UI 风格，蓝色渐变头部栏
- 行间色交替的表格样式，提高可读性
- 主键字段红色高亮显示
- 非必填字段特殊标记

## 界面预览

![主界面预览](https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=screenshot%20of%20a%20modern%20desktop%20application%20with%20blue%20gradient%20header%2C%20left%20sidebar%20with%20tree%20navigation%20showing%20database%20tables%2C%20right%20panel%20showing%20database%20schema%20overview%20table%20with%20alternating%20row%20colors%2C%20clean%20professional%20UI%20design%2C%20PyQt5%20application&image_size=landscape_16_9)

![字段详情预览](https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=screenshot%20of%20database%20schema%20detail%20view%20showing%20column%20definitions%20table%20with%20fields%20like%20column%20name%2C%20type%2C%20primary%20key%2C%20required%2C%20default%20value%2C%20alternating%20green%20and%20white%20row%20background%20colors%2C%20professional%20database%20documentation%20style&image_size=landscape_16_9)

## 环境要求

- **Python**: 3.8 或更高版本
- **操作系统**: Windows 10/11
- **依赖**: PyQt5

## 快速开始

### 方式一：直接运行 EXE（推荐）

从 [Releases](https://github.com/hp6120c/xml-viewer/releases) 下载最新版本的 `XML数据库设计查看器.exe`，双击运行即可。

### 方式二：从源码运行

```bash
# 1. 克隆仓库
git clone https://github.com/hp6120c/xml-viewer.git
cd xml-viewer

# 2. 创建虚拟环境
python -m venv .venv
.venv\Scripts\activate  # Windows
# source .venv/bin/activate  # Linux/Mac

# 3. 安装依赖
pip install -r requirements.txt

# 4. 运行程序
python main.py
```

## 使用说明

### 打开文件

1. **菜单方式**: 点击工具栏的 "📂 打开文件夹" 按钮，选择包含 XML 文件的文件夹
2. **拖拽方式**: 直接拖拽 XML 文件或文件夹到窗口

### 浏览表结构

1. 左侧树形导航按 `模块 → 子模块 → 表` 层级组织
2. 点击任意表名，右侧显示该表的完整字段详情
3. 点击 "← 返回目录" 链接返回表目录概览

### 编辑 XML

1. 点击工具栏的 "✏️ 编辑模式" 按钮
2. 编辑器会自动定位到当前查看的表对应的 XML 位置
3. 修改完成后点击 "👁️ 阅读模式" 保存并刷新显示

### 搜索过滤

在搜索框中输入表名或字段名，左侧树形导航会实时过滤显示匹配项。

## 项目结构

```
xml_viewer/
├── main.py              # 程序入口
├── build.py             # 打包脚本
├── requirements.txt     # Python 依赖
├── .gitignore           # Git 忽略规则
├── ui/
│   ├── __init__.py
│   └── main_window.py   # 主窗口界面
└── utils/
    ├── __init__.py
    └── xml_parser.py    # XML 解析器
```

## 打包成 EXE

### 方法一：使用打包脚本（推荐）

```bash
# 激活虚拟环境
.venv\Scripts\activate

# 运行打包脚本
python build.py
```

打包完成后，EXE 文件位于 `dist/XML数据库设计查看器.exe`。

### 方法二：手动使用 PyInstaller

```bash
# 安装 PyInstaller
pip install pyinstaller

# 打包
pyinstaller --onefile --windowed \
  --name "XML数据库设计查看器" \
  --icon=NONE \
  --add-data "ui;ui" \
  --add-data "utils;utils" \
  --hidden-import PyQt5.sip \
  main.py
```

### 打包参数说明

| 参数 | 说明 |
|------|------|
| `--onefile` | 打包成单个 EXE 文件 |
| `--windowed` | 不显示控制台窗口 |
| `--name` | 指定 EXE 文件名 |
| `--add-data` | 添加额外的数据文件 |
| `--hidden-import` | 显式导入隐藏依赖 |

## 技术栈

- **GUI 框架**: PyQt5
- **XML 解析**: xml.etree.ElementTree
- **打包工具**: PyInstaller
- **Python 版本**: 3.8+

## 常见问题

### Q: 启动时提示 "No module named 'PyQt5'"
确保已安装依赖：
```bash
pip install PyQt5
```

### Q: 打包后 exe 无法运行
尝试添加 `--hidden-import` 参数：
```bash
pyinstaller --hidden-import PyQt5.sip --hidden-import PyQt5.QtWidgets main.py
```

### Q: 中文显示乱码
程序默认使用 "微软雅黑" 字体，确保系统已安装该字体。

## License

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request！
