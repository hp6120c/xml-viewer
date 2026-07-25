import os
import sys
import json
import html
from PyQt5.QtWidgets import (
    QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
    QTreeWidget, QTreeWidgetItem, QSplitter, QLabel,
    QFileDialog, QMessageBox, QLineEdit, QTextBrowser,
    QFrame, QSizePolicy, QAbstractItemView, QTabWidget,
    QPushButton, QTabBar, QPlainTextEdit, QStackedWidget,
    QMenu, QAction,
)
from PyQt5.QtCore import Qt, QUrl, QTimer, QMimeData
from PyQt5.QtGui import QFont, QColor, QPalette, QDragEnterEvent, QDropEvent, QDesktopServices

from utils.xml_parser import XMLParser


# ── helpers ───────────────────────────────────────────────────

def _esc(text):
    return html.escape(str(text)) if text else ''

def _row_bg(idx):
    return '#f2f3dd' if idx % 2 == 1 else '#E7EBE9'


# ── Config persistence ────────────────────────────────────────

def _config_path():
    """Return path to the config JSON file in %APPDATA% (or script dir for dev)."""
    if getattr(sys, 'frozen', False):
        base = os.path.join(os.environ.get('APPDATA', os.path.expanduser('~')), 'XMLDatabaseViewer')
    else:
        base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    os.makedirs(base, exist_ok=True)
    return os.path.join(base, 'viewer_config.json')

def _load_config():
    p = _config_path()
    if os.path.exists(p):
        try:
            with open(p, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            pass
    return {}

def _save_config(cfg):
    try:
        with open(_config_path(), 'w', encoding='utf-8') as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


# ── MainWindow ────────────────────────────────────────────────

def _read_version():
    """Read version string from version.txt."""
    candidates = [
        os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'version.txt'),
        os.path.join(os.path.dirname(os.path.abspath(__file__)), 'version.txt'),
    ]
    if getattr(sys, 'frozen', False):
        candidates.insert(0, os.path.join(os.path.dirname(sys.executable), 'version.txt'))
    for p in candidates:
        if os.path.exists(p):
            try:
                with open(p, 'r', encoding='utf-8') as f:
                    v = f.read().strip()
                    if v:
                        return v
            except Exception:
                pass
    return '1.0'


class MainWindow(QMainWindow):

    def __init__(self):
        super().__init__()
        self._version = _read_version()
        self.setWindowTitle(f'数据库设计查看器 V{self._version}')
        self.setGeometry(60, 40, 1400, 900)
        self.setAcceptDrops(True)

        # file_path → parsed data
        self._file_data = {}
        # file_path → list of all tables (flat)
        self._file_tables = {}

        self._build_ui()
        self._apply_style()

        # Restore last session
        self._restore_session()

    # ── UI construction ───────────────────────────────────────

    def _build_ui(self):
        central = QWidget()
        self.setCentralWidget(central)
        root = QVBoxLayout(central)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(0)

        root.addWidget(self._build_header())
        root.addWidget(self._build_toolbar())
        root.addWidget(self._build_stats_bar())

        # Main tab widget – each tab = one XML file
        self.tab_widget = QTabWidget()
        self.tab_widget.setTabsClosable(True)
        self.tab_widget.setMovable(True)
        self.tab_widget.tabCloseRequested.connect(self._close_tab)
        self.tab_widget.currentChanged.connect(self._on_tab_changed)
        self.tab_widget.setDocumentMode(True)
        self.tab_widget.setContextMenuPolicy(Qt.CustomContextMenu)
        self.tab_widget.customContextMenuRequested.connect(self._tab_context_menu)
        root.addWidget(self.tab_widget, 1)

    def _build_header(self):
        frame = QFrame()
        frame.setObjectName('headerBar')
        frame.setFixedHeight(56)
        h = QHBoxLayout(frame)
        h.setContentsMargins(24, 0, 24, 0)
        title = QLabel(f'📊 数据库设计查看器 V{self._version}')
        title.setObjectName('headerTitle')
        sub = QLabel('支持拖拽文件/文件夹')
        sub.setObjectName('headerSub')
        h.addWidget(title)
        h.addSpacing(16)
        h.addWidget(sub, 1, Qt.AlignVCenter)
        github_link = QLabel('<a href="https://github.com/hp6120c/xml-viewer" '
                             'style="color:rgba(255,255,255,0.85);text-decoration:none;font-size:11px;">'
                             'https://github.com/hp6120c/xml-viewer</a>')
        github_link.setOpenExternalLinks(True)
        github_link.setCursor(Qt.PointingHandCursor)
        h.addWidget(github_link, 0, Qt.AlignVCenter)
        return frame

    def _build_toolbar(self):
        frame = QFrame()
        frame.setObjectName('toolbar')
        h = QHBoxLayout(frame)
        h.setContentsMargins(12, 6, 12, 6)
        h.setSpacing(8)

        self.btn_open = self._make_btn('📂 打开文件夹')
        self.btn_open.clicked.connect(self._open_folder)
        h.addWidget(self.btn_open)

        self.btn_open_file = self._make_btn('📄 打开文件')
        self.btn_open_file.clicked.connect(self._open_files)
        h.addWidget(self.btn_open_file)

        self.btn_refresh = self._make_btn('🔄 刷新')
        self.btn_refresh.clicked.connect(self._refresh)
        h.addWidget(self.btn_refresh)

        self.btn_edit_mode = self._make_btn('✏️ 编辑模式')
        self.btn_edit_mode.setCheckable(True)
        self.btn_edit_mode.clicked.connect(self._toggle_edit_mode)
        h.addWidget(self.btn_edit_mode)

        self.search_box = QLineEdit()
        self.search_box.setPlaceholderText('🔍 搜索表名/字段名...')
        self.search_box.setFixedWidth(260)
        self.search_box.setObjectName('searchBox')
        self.search_box.textChanged.connect(self._on_search)
        h.addWidget(self.search_box)

        h.addStretch()

        self.file_info_label = QLabel('')
        self.file_info_label.setObjectName('fileInfoLabel')
        h.addWidget(self.file_info_label)

        return frame

    @staticmethod
    def _make_btn(text):
        b = QPushButton(text)
        b.setObjectName('toolBtn')
        b.setCursor(Qt.PointingHandCursor)
        return b

    def _build_stats_bar(self):
        frame = QFrame()
        frame.setObjectName('statsBar')
        frame.setFixedHeight(28)
        h = QHBoxLayout(frame)
        h.setContentsMargins(16, 0, 16, 0)
        h.setSpacing(24)
        self.stat_modules = QLabel('模块: 0')
        self.stat_tables = QLabel('表: 0')
        self.stat_columns = QLabel('字段: 0')
        for lbl in (self.stat_modules, self.stat_tables, self.stat_columns):
            lbl.setObjectName('statLabel')
            h.addWidget(lbl)
        h.addStretch()
        return frame

    # ── Styling ───────────────────────────────────────────────

    def _apply_style(self):
        self.setStyleSheet('''
            #headerBar {
                background: qlineargradient(x1:0,y1:0,x2:1,y2:0,
                    stop:0 #0984e3, stop:1 #6c5ce7);
            }
            #headerTitle {
                color: white;
                font-size: 18px;
                font-weight: bold;
            }
            #headerSub {
                color: rgba(255,255,255,0.75);
                font-size: 12px;
            }
            #toolbar {
                background: #ffffff;
                border-bottom: 1px solid #dfe6e9;
            }
            #toolBtn {
                padding: 5px 14px;
                border: 1px solid #b2bec3;
                border-radius: 5px;
                background: #ffffff;
                font-size: 13px;
            }
            #toolBtn:hover {
                background: #0984e3;
                color: white;
                border-color: #0984e3;
            }
            #toolBtn:checked {
                background: #e17055;
                color: white;
                border-color: #e17055;
            }
            #searchBox {
                padding: 4px 10px;
                border: 1px solid #b2bec3;
                border-radius: 5px;
                font-size: 13px;
            }
            #searchBox:focus {
                border-color: #0984e3;
            }
            #fileInfoLabel {
                font-size: 12px;
                color: #636e72;
            }
            #statsBar {
                background: #ffffff;
                border-bottom: 1px solid #dfe6e9;
            }
            #statLabel {
                font-size: 12px;
                color: #636e72;
            }
            QTabWidget::pane {
                border: none;
            }
            QTabBar::tab {
                padding: 6px 18px;
                font-size: 12px;
                background: #f5f6fa;
                border: 1px solid #dfe6e9;
                border-bottom: none;
                border-top-left-radius: 4px;
                border-top-right-radius: 4px;
                margin-right: 2px;
            }
            QTabBar::tab:selected {
                background: #0984e3;
                color: white;
                font-weight: bold;
                border-color: #0984e3;
            }
            QTabBar::tab:hover:!selected {
                background: #eef2f7;
            }
        ''')

    # ── Tab creation ──────────────────────────────────────────

    def _create_tab(self, file_path, data):
        """Create a new tab for one XML file: splitter(tree + browser)."""
        tables = XMLParser.get_all_tables(data)
        self._file_data[file_path] = data
        self._file_tables[file_path] = tables

        # Build tab widget
        tab = QWidget()
        layout = QHBoxLayout(tab)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        splitter = QSplitter(Qt.Horizontal)
        splitter.setHandleWidth(3)

        # Left: tree for this file
        tree = QTreeWidget()
        tree.setHeaderHidden(True)
        tree.setRootIsDecorated(True)
        tree.setIndentation(14)
        tree.setAnimated(True)
        tree.setSelectionMode(QAbstractItemView.SingleSelection)
        tree.setMinimumWidth(180)
        tree.setMaximumWidth(400)
        tree.setObjectName('fileTree')

        # Build tree with module → submodule → table structure
        for db in data.get('databases', []):
            for module in db.get('submodules', []) + db.get('modules', []):
                mod_name = module.get('name', module.get('id', ''))
                mod_item = QTreeWidgetItem(tree)
                mod_item.setText(0, f'📁 {mod_name}')
                fnt = mod_item.font(0)
                fnt.setBold(True)
                mod_item.setFont(0, fnt)
                mod_item.setExpanded(True)

                for sub in module.get('submodules', []):
                    sub_name = sub.get('name', sub.get('id', ''))
                    if sub_name != mod_name:
                        sub_item = QTreeWidgetItem(mod_item)
                        sub_item.setText(0, f'📂 {sub_name}')
                        sfnt = sub_item.font(0)
                        sfnt.setBold(True)
                        sub_item.setFont(0, sfnt)
                        parent_for_tables = sub_item
                    else:
                        parent_for_tables = mod_item

                    for t in sub.get('tables', []):
                        ti = QTreeWidgetItem(parent_for_tables)
                        ti.setText(0, f"{t['id']} ({t.get('name', '')})")
                        ti.setData(0, Qt.UserRole, ('table', t['id']))
                        parent_for_tables.setExpanded(True)

        tree.itemClicked.connect(lambda item, col, fp=file_path: self._on_tree_click(item, col, fp))

        # Right: stacked widget (overview + detail + editor)
        right_stack = QStackedWidget()

        overview_browser = QTextBrowser()
        overview_browser.setOpenExternalLinks(False)
        overview_browser.setPlaceholderText('点击查看表详情')
        overview_browser.anchorClicked.connect(self._on_anchor_clicked)

        detail_browser = QTextBrowser()
        detail_browser.setOpenExternalLinks(False)
        detail_browser.anchorClicked.connect(self._on_anchor_clicked)

        editor = QPlainTextEdit()
        editor.setPlaceholderText('XML 编辑器')
        editor.setFont(QFont('Consolas', 11))
        editor.setTabStopDistance(40)

        right_stack.addWidget(overview_browser)  # index 0 = overview
        right_stack.addWidget(detail_browser)     # index 1 = detail view
        right_stack.addWidget(editor)             # index 2 = edit mode

        # Store refs on the tab
        tab._tree = tree
        tab._overview_browser = overview_browser
        tab._detail_browser = detail_browser
        tab._editor = editor
        tab._stack = right_stack
        tab._file_path = file_path
        tab._html_loaded = False

        splitter.addWidget(tree)
        splitter.addWidget(right_stack)
        splitter.setSizes([260, 1000])
        splitter.setStretchFactor(0, 0)
        splitter.setStretchFactor(1, 1)

        layout.addWidget(splitter)

        # Don't generate HTML here – defer to first view

        # Add tab (don't switch to it automatically)
        fname = os.path.basename(file_path)
        idx = self.tab_widget.addTab(tab, fname)
        self.tab_widget.setTabToolTip(idx, file_path)

        self._update_stats()
        self._update_info_label()

    # ── File / Folder operations ──────────────────────────────

    def _open_folder(self):
        folder = QFileDialog.getExistingDirectory(self, '选择包含XML文件的文件夹')
        if folder:
            self._load_folder(folder)

    def _open_files(self):
        paths, _ = QFileDialog.getOpenFileNames(
            self, '选择XML文件', '',
            'XML文件 (*.xml);;所有文件 (*)')
        if paths:
            for p in paths:
                self._load_single_file(p)
            self._save_session()

    def _load_folder(self, folder_path):
        try:
            xml_files = XMLParser.get_folder_xml_files(folder_path)
            if not xml_files:
                QMessageBox.information(self, '提示', '所选文件夹中没有找到XML文件')
                return

            # Filter out already-open files
            to_load = [fp for fp in xml_files if fp not in self._file_data]
            if not to_load:
                return

            # Load files one at a time via QTimer to keep UI responsive
            self._pending_files = to_load
            self._load_next_file()

        except Exception as e:
            QMessageBox.critical(self, '错误', f'加载文件夹时出错:\n{e}')

    def _load_next_file(self):
        if not hasattr(self, '_pending_files') or not self._pending_files:
            self._save_session()
            self.statusBar().showMessage('加载完成', 3000) if self.statusBar() else None
            return

        fp = self._pending_files.pop(0)
        data = XMLParser.parse_file(fp)
        if data:
            self._create_tab(fp, data)

        # Process next file after a short delay to keep UI responsive
        QTimer.singleShot(0, self._load_next_file)

    def _load_single_file(self, file_path):
        if file_path in self._file_data:
            # Already open – switch to that tab
            for i in range(self.tab_widget.count()):
                tab = self.tab_widget.widget(i)
                if hasattr(tab, '_file_path') and tab._file_path == file_path:
                    self.tab_widget.setCurrentIndex(i)
                    return
            return

        data = XMLParser.parse_file(file_path)
        if data:
            self._create_tab(file_path, data)
        else:
            QMessageBox.warning(self, '错误', f'无法解析文件: {file_path}')

    def _refresh(self):
        """Reload all currently open files."""
        open_paths = []
        for i in range(self.tab_widget.count()):
            tab = self.tab_widget.widget(i)
            if hasattr(tab, '_file_path'):
                open_paths.append(tab._file_path)

        # Close all tabs
        self.tab_widget.clear()
        self._file_data.clear()
        self._file_tables.clear()

        # Reload
        for fp in open_paths:
            data = XMLParser.parse_file(fp)
            if data:
                self._create_tab(fp, data)

    def _close_tab(self, index):
        tab = self.tab_widget.widget(index)
        fname = ''
        if hasattr(tab, '_file_path'):
            fname = os.path.basename(tab._file_path)
        reply = QMessageBox.question(
            self, '确认关闭',
            f'确定要关闭 "{fname}" 吗？',
            QMessageBox.Yes | QMessageBox.No,
            QMessageBox.No)
        if reply != QMessageBox.Yes:
            return
        if hasattr(tab, '_file_path'):
            fp = tab._file_path
            self._file_data.pop(fp, None)
            self._file_tables.pop(fp, None)
        self.tab_widget.removeTab(index)
        self._update_stats()
        self._update_info_label()

    def _tab_context_menu(self, pos):
        """Right-click context menu on tab bar."""
        bar = self.tab_widget.tabBar()
        tab_idx = bar.tabAt(pos)
        if tab_idx < 0:
            return

        menu = QMenu(self)
        menu.setStyleSheet('QMenu { padding: 4px 8px; } QMenu::item { padding: 4px 20px; }')

        act_close_right = menu.addAction('关闭右侧标签页')
        act_close_others = menu.addAction('关闭其他标签页')
        act_close_all = menu.addAction('关闭所有标签页')

        action = menu.exec_(bar.mapToGlobal(pos))
        if action == act_close_right:
            self._close_tabs_to_right(tab_idx)
        elif action == act_close_others:
            self._close_other_tabs(tab_idx)
        elif action == act_close_all:
            self._close_all_tabs()

    def _close_tabs_to_right(self, from_index):
        """Close all tabs to the right of from_index."""
        if from_index >= self.tab_widget.count() - 1:
            return
        count = self.tab_widget.count() - 1 - from_index
        names = []
        for i in range(from_index + 1, self.tab_widget.count()):
            tab = self.tab_widget.widget(i)
            if hasattr(tab, '_file_path'):
                names.append(os.path.basename(tab._file_path))
        if not names:
            return
        preview = '、'.join(names[:5])
        if len(names) > 5:
            preview += f' 等 {len(names)} 个文件'
        reply = QMessageBox.question(
            self, '确认关闭',
            f'确定要关闭右侧 {count} 个标签页吗？\n\n{preview}',
            QMessageBox.Yes | QMessageBox.No,
            QMessageBox.No)
        if reply != QMessageBox.Yes:
            return
        for i in range(self.tab_widget.count() - 1, from_index, -1):
            tab = self.tab_widget.widget(i)
            if hasattr(tab, '_file_path'):
                fp = tab._file_path
                self._file_data.pop(fp, None)
                self._file_tables.pop(fp, None)
            self.tab_widget.removeTab(i)
        self._update_stats()
        self._update_info_label()

    def _close_other_tabs(self, keep_index):
        """Close all tabs except the one at keep_index."""
        if self.tab_widget.count() <= 1:
            return
        names = []
        for i in range(self.tab_widget.count()):
            if i != keep_index:
                tab = self.tab_widget.widget(i)
                if hasattr(tab, '_file_path'):
                    names.append(os.path.basename(tab._file_path))
        if not names:
            return
        preview = '、'.join(names[:5])
        if len(names) > 5:
            preview += f' 等 {len(names)} 个文件'
        reply = QMessageBox.question(
            self, '确认关闭',
            f'确定要关闭以下标签页吗？\n\n{preview}',
            QMessageBox.Yes | QMessageBox.No,
            QMessageBox.No)
        if reply != QMessageBox.Yes:
            return

        # Close from end to start to keep indices valid
        for i in range(self.tab_widget.count() - 1, -1, -1):
            if i != keep_index:
                tab = self.tab_widget.widget(i)
                if hasattr(tab, '_file_path'):
                    fp = tab._file_path
                    self._file_data.pop(fp, None)
                    self._file_tables.pop(fp, None)
                self.tab_widget.removeTab(i)
        self._update_stats()
        self._update_info_label()

    def _close_all_tabs(self):
        """Close all tabs."""
        if self.tab_widget.count() == 0:
            return
        reply = QMessageBox.question(
            self, '确认关闭',
            f'确定要关闭所有 {self.tab_widget.count()} 个标签页吗？',
            QMessageBox.Yes | QMessageBox.No,
            QMessageBox.No)
        if reply != QMessageBox.Yes:
            return
        self.tab_widget.clear()
        self._file_data.clear()
        self._file_tables.clear()
        self._update_stats()
        self._update_info_label()

    def _toggle_edit_mode(self, checked):
        """Toggle between read mode and edit mode for the current tab."""
        idx = self.tab_widget.currentIndex()
        if idx < 0:
            self.btn_edit_mode.setChecked(False)
            return
        tab = self.tab_widget.widget(idx)
        if not hasattr(tab, '_stack'):
            self.btn_edit_mode.setChecked(False)
            return

        if checked:
            # Enter edit mode: load selected table's XML or full file
            fp = tab._file_path
            try:
                try:
                    with open(fp, 'r', encoding='utf-8') as f:
                        raw = f.read()
                except UnicodeDecodeError:
                    with open(fp, 'r', encoding='gbk') as f:
                        raw = f.read()
            except Exception as e:
                QMessageBox.warning(self, '错误', f'读取文件失败:\n{e}')
                self.btn_edit_mode.setChecked(False)
                return

            # If a table is selected, extract only that table's XML
            table_id = getattr(tab, '_viewing_table_id', None)
            if table_id:
                tab_content = self._extract_table_xml(raw, table_id)
                if tab_content:
                    tab._editing_table_id = table_id
                    tab._editor.setPlainText(tab_content)
                else:
                    tab._editing_table_id = None
                    tab._editor.setPlainText(raw)
            else:
                tab._editing_table_id = None
                tab._editor.setPlainText(raw)

            tab._stack.setCurrentIndex(2)  # editor
            self.btn_edit_mode.setText('👁️ 阅读模式')
        else:
            # Exit edit mode: save and re-render
            fp = tab._file_path
            new_content = tab._editor.toPlainText()

            # If editing a single table, replace only that table in the full file
            editing_tid = getattr(tab, '_editing_table_id', None)
            if editing_tid:
                try:
                    try:
                        with open(fp, 'r', encoding='utf-8') as f:
                            full_raw = f.read()
                    except UnicodeDecodeError:
                        with open(fp, 'r', encoding='gbk') as f:
                            full_raw = f.read()
                    merged = self._replace_table_xml(full_raw, editing_tid, new_content)
                    with open(fp, 'w', encoding='utf-8') as f:
                        f.write(merged)
                except Exception as e:
                    QMessageBox.warning(self, '错误', f'保存文件失败:\n{e}')
                    return
            else:
                try:
                    with open(fp, 'w', encoding='utf-8') as f:
                        f.write(new_content)
                except Exception as e:
                    QMessageBox.warning(self, '错误', f'保存文件失败:\n{e}')
                    return

            # Re-parse and refresh
            data = XMLParser.parse_file(fp)
            if data:
                self._file_data[fp] = data
                tables = XMLParser.get_all_tables(data)
                self._file_tables[fp] = tables
                tab._html_loaded = False
                tab._editing_table_id = None

            tab._stack.setCurrentIndex(0)
            if not tab._html_loaded:
                fp2 = tab._file_path
                d = self._file_data.get(fp2)
                t = self._file_tables.get(fp2, [])
                if d:
                    tab._overview_browser.setHtml(self._build_file_html(fp2, d, t))
                tab._html_loaded = True
            self.btn_edit_mode.setText('✏️ 编辑模式')

    def _extract_table_xml(self, full_xml, table_id):
        """Extract the XML block for a specific table from the full XML."""
        import re
        # Match <table id="TABLE_ID">...</table> (with optional whitespace/newlines)
        pattern = r'(<table\s+[^>]*id\s*=\s*["\']' + re.escape(table_id) + r'["\'][^>]*>)(.*?)(</table>)'
        match = re.search(pattern, full_xml, re.DOTALL | re.IGNORECASE)
        if match:
            return match.group(0)
        return None

    def _replace_table_xml(self, full_xml, table_id, new_table_xml):
        """Replace a specific table's XML block in the full XML."""
        import re
        pattern = r'<table\s+[^>]*id\s*=\s*["\']' + re.escape(table_id) + r'["\'][^>]*>.*?</table>'
        result = re.sub(pattern, new_table_xml, full_xml, count=1, flags=re.DOTALL | re.IGNORECASE)
        return result

    # ── Drag & Drop ───────────────────────────────────────────

    def dragEnterEvent(self, event: QDragEnterEvent):
        if event.mimeData().hasUrls():
            event.acceptProposedAction()

    def dropEvent(self, event: QDropEvent):
        urls = event.mimeData().urls()
        if not urls:
            return

        xml_files = []
        for url in urls:
            path = url.toLocalFile()
            if os.path.isdir(path):
                xml_files.extend(XMLParser.get_folder_xml_files(path))
            elif os.path.isfile(path) and path.lower().endswith('.xml'):
                xml_files.append(path)

        for fp in xml_files:
            if fp not in self._file_data:
                data = XMLParser.parse_file(fp)
                if data:
                    self._create_tab(fp, data)

        if xml_files:
            self._save_session()

    # ── Session persistence ───────────────────────────────────

    def _save_session(self):
        cfg = _load_config()
        open_files = []
        for i in range(self.tab_widget.count()):
            tab = self.tab_widget.widget(i)
            if hasattr(tab, '_file_path'):
                open_files.append(tab._file_path)
        cfg['last_open_files'] = open_files
        if open_files:
            cfg['last_folder'] = os.path.dirname(open_files[0])
        cfg['geometry'] = {
            'x': self.x(), 'y': self.y(),
            'w': self.width(), 'h': self.height(),
        }
        _save_config(cfg)

    def _restore_session(self):
        cfg = _load_config()
        # Restore geometry
        geo = cfg.get('geometry')
        if geo:
            self.setGeometry(geo['x'], geo['y'], geo['w'], geo['h'])

        # Restore open files
        last_files = cfg.get('last_open_files', [])
        restored = 0
        for fp in last_files:
            if os.path.isfile(fp):
                data = XMLParser.parse_file(fp)
                if data:
                    self._create_tab(fp, data)
                    restored += 1

        if restored == 0:
            # Try last folder
            last_folder = cfg.get('last_folder', '')
            if last_folder and os.path.isdir(last_folder):
                self._load_folder(last_folder)

    # ── Stats ─────────────────────────────────────────────────

    def _update_stats(self):
        modules = set()
        total_tables = 0
        total_cols = 0
        for fp, tables in self._file_tables.items():
            for t in tables:
                modules.add((fp, t.get('module_id', '')))
                total_tables += 1
                total_cols += len(t.get('columns', []))
        self.stat_modules.setText(f'模块: {len(modules)}')
        self.stat_tables.setText(f'表: {total_tables}')
        self.stat_columns.setText(f'字段: {total_cols}')

    def _update_info_label(self):
        count = self.tab_widget.count()
        if count > 0:
            self.file_info_label.setText(f'已打开 {count} 个文件')
        else:
            self.file_info_label.setText('请打开文件夹或拖拽XML文件')

    def _on_tab_changed(self, index):
        if index < 0:
            return
        tab = self.tab_widget.widget(index)
        if tab and hasattr(tab, '_html_loaded') and not tab._html_loaded:
            # First time viewing this tab – generate HTML now
            fp = tab._file_path
            data = self._file_data.get(fp)
            tables = self._file_tables.get(fp, [])
            if data:
                html_content = self._build_file_html(fp, data, tables)
                tab._overview_browser.setHtml(html_content)
            tab._html_loaded = True
        self._update_stats()

    # ── HTML generation ───────────────────────────────────────

    def _build_file_html(self, file_path, data, tables):
        parts = [self._css(), '<body>']

        # a) 表目录 heading
        parts.append('<div style="text-align:center;margin:16px 0 24px 0;">')
        parts.append('<h2 style="font-size:22px;margin:0;">表目录</h2>')
        parts.append(f'<p style="font-size:12px;color:#636e72;">{_esc(os.path.basename(file_path))}</p>')
        parts.append('</div>')

        # b) Per-module sections
        for db in data.get('databases', []):
            for module in db.get('modules', []):
                mod_name = module.get('name', module.get('id', ''))
                mod_tables = []
                for sub in module.get('submodules', []):
                    for t in sub.get('tables', []):
                        t_copy = dict(t)
                        t_copy['_submodule_name'] = sub.get('name', sub.get('id', ''))
                        mod_tables.append(t_copy)

                if not mod_tables:
                    continue

                anchor_id = f'mod_{_esc(mod_name)}'
                parts.append(f'<div id="{anchor_id}" style="margin-top:24px;">')
                parts.append(
                    f'<div style="background:#d7e2da;padding:8px 14px;border-radius:4px;'
                    f'font-weight:bold;font-size:14px;margin-bottom:2px;">'
                    f'子模块 {_esc(mod_name)} 部分</div>'
                )
                parts.append(
                    '<table style="width:95%;margin:0 auto;border-collapse:collapse;font-size:12px;">'
                )
                parts.append('<thead><tr style="background:#d7e2da;">')
                for hdr in ('业务细目', '业务英文标识名', '业务中文名称',
                            '生产表模式名', '类型', '字段数', '存储容量', '数据更新频率'):
                    parts.append(f'<th style="padding:6px 8px;text-align:left;border:1px solid #c0c0c0;">{hdr}</th>')
                parts.append('</tr></thead><tbody>')

                for idx, t in enumerate(mod_tables, 1):
                    bg = _row_bg(idx)
                    col_count = len(t.get('columns', []))
                    table_type = t.get('type', '') or '表'
                    freq = t.get('frequency', '') or '不更新'
                    parts.append(f'<tr style="background:{bg};">')
                    parts.append(f'<td style="padding:5px 8px;border:1px solid #d0d0d0;">{_esc(t.get("_submodule_name", ""))}</td>')
                    parts.append(
                        f'<td style="padding:5px 8px;border:1px solid #d0d0d0;">'
                        f'<a href="#{_esc(t["id"])}" style="color:#0984e3;text-decoration:none;">'
                        f'{_esc(t["id"])}</a></td>'
                    )
                    parts.append(f'<td style="padding:5px 8px;border:1px solid #d0d0d0;">{_esc(t.get("name", ""))}</td>')
                    parts.append(f'<td style="padding:5px 8px;border:1px solid #d0d0d0;text-align:center;">{_esc(db.get("id", ""))}</td>')
                    parts.append(f'<td style="padding:5px 8px;border:1px solid #d0d0d0;text-align:center;">{_esc(table_type)}</td>')
                    parts.append(f'<td style="padding:5px 8px;border:1px solid #d0d0d0;text-align:center;">{col_count}</td>')
                    parts.append(f'<td style="padding:5px 8px;border:1px solid #d0d0d0;text-align:center;">{_esc(t.get("volume", ""))}</td>')
                    parts.append(f'<td style="padding:5px 8px;border:1px solid #d0d0d0;text-align:center;">{_esc(freq)}</td>')
                    parts.append('</tr>')
                parts.append('</tbody></table></div>')

        # c) 全部表目录
        parts.append('<div style="margin-top:32px;text-align:center;">')
        parts.append('<h2 style="font-size:22px;" id="alltable">全部表目录</h2>')
        parts.append('</div>')
        parts.append(
            '<table style="width:95%;margin:0 auto;border-collapse:collapse;font-size:12px;">'
        )
        parts.append('<thead><tr style="background:#d7e2da;">')
        for hdr in ('序号', '模块大类', '业务细目', '业务英文标识名',
                     '业务中文名称', '生产表模式名', '类型', '字段数',
                     '存储容量', '数据更新频率'):
            parts.append(f'<th style="padding:6px 8px;text-align:left;border:1px solid #c0c0c0;">{hdr}</th>')
        parts.append('</tr></thead><tbody>')

        for idx, t in enumerate(tables, 1):
            bg = _row_bg(idx)
            col_count = len(t.get('columns', []))
            table_type = t.get('type', '') or '表'
            freq = t.get('frequency', '') or '不更新'
            parts.append(f'<tr style="background:{bg};">')
            parts.append(f'<td style="padding:5px 8px;border:1px solid #d0d0d0;text-align:center;">{idx}</td>')
            parts.append(f'<td style="padding:5px 8px;border:1px solid #d0d0d0;">{_esc(t.get("module_name", ""))}</td>')
            parts.append(f'<td style="padding:5px 8px;border:1px solid #d0d0d0;">{_esc(t.get("submodule_name", ""))}</td>')
            parts.append(
                f'<td style="padding:5px 8px;border:1px solid #d0d0d0;">'
                f'<a href="#{_esc(t["id"])}" style="color:#0984e3;text-decoration:none;">'
                f'{_esc(t["id"])}</a></td>'
            )
            parts.append(f'<td style="padding:5px 8px;border:1px solid #d0d0d0;">{_esc(t.get("name", ""))}</td>')
            parts.append(f'<td style="padding:5px 8px;border:1px solid #d0d0d0;text-align:center;">{_esc(t.get("database_id", ""))}</td>')
            parts.append(f'<td style="padding:5px 8px;border:1px solid #d0d0d0;text-align:center;">{_esc(table_type)}</td>')
            parts.append(f'<td style="padding:5px 8px;border:1px solid #d0d0d0;text-align:center;">{col_count}</td>')
            parts.append(f'<td style="padding:5px 8px;border:1px solid #d0d0d0;text-align:center;">{_esc(t.get("volume", ""))}</td>')
            parts.append(f'<td style="padding:5px 8px;border:1px solid #d0d0d0;text-align:center;">{_esc(freq)}</td>')
            parts.append('</tr>')
        parts.append('</tbody></table>')

        parts.append('</body></html>')
        return '\n'.join(parts)

    def _build_detail_html(self, file_path, table_id):
        """Append one table's detail to the cached overview HTML."""
        tables = self._file_tables.get(file_path, [])
        # Find the target table
        target = None
        for t in tables:
            if t['id'] == table_id:
                target = t
                break
        if not target:
            return None
        # Get or build the overview base (without closing tags)
        idx = self.tab_widget.currentIndex()
        tab = self.tab_widget.widget(idx) if idx >= 0 else None
        if tab and hasattr(tab, '_html_base') and tab._html_base:
            base = tab._html_base
        else:
            data = self._file_data.get(file_path)
            if not data:
                return None
            overview = self._build_file_html(file_path, data, tables)
            base = overview.rstrip()
            if base.endswith('</body></html>'):
                base = base[:-len('</body></html>')]
            if tab:
                tab._html_base = base
        parts = [base, '<hr style="margin:32px 0;border:none;border-top:2px solid #dfe6e9;">',
                 self._build_table_detail_html(target), '</body></html>']
        return '\n'.join(parts)

    def _build_table_detail_html(self, table):
        tid = table['id']
        tname = table.get('name', '')
        columns = table.get('columns', [])
        remarks = table.get('remarks', '')
        view = table.get('view', 'false')
        sql = table.get('sql', '')
        module_id = table.get('module_id', '')

        parts = []
        parts.append(f'<div id="{_esc(tid)}" style="margin-top:28px;padding-top:8px;">')

        parts.append(
            f'<h5 style="text-align:center;margin:0 0 4px 0;font-size:15px;">'
            f'{_esc(tid)} ({_esc(tname)}) '
            f'<a href="#mod_{_esc(module_id)}" style="font-size:11px;color:#0984e3;'
            f'text-decoration:none;margin-left:8px;">返回</a></h5>'
        )

        if view and view != 'false':
            parts.append(f'<p style="text-align:center;color:#636e72;font-size:12px;">视图 SQL: {_esc(sql)}</p>')

        if remarks:
            parts.append(
                f'<p style="text-align:center;color:green;font-size:12px;white-space:pre-line;">'
                f'{_esc(remarks)}</p>'
            )

        parts.append(
            '<table style="width:95%;margin:4px auto;border-collapse:collapse;font-size:12px;">'
        )
        parts.append('<thead><tr style="background:#d7e2da;">')
        for hdr in ('序号', 'ID', 'Name', 'primaryKey', 'type',
                     'enumValue', 'required', 'default', 'format',
                     'inputsize', 'Note'):
            parts.append(
                f'<th style="padding:5px 8px;text-align:left;border:1px solid #c0c0d0;">'
                f'<span style="font-size:11px;">{hdr}</span></th>'
            )
        parts.append('</tr></thead><tbody>')

        for idx, col in enumerate(columns, 1):
            bg = _row_bg(idx)
            parts.append(f'<tr style="background:{bg};">')
            parts.append(f'<td style="padding:4px 8px;border:1px solid #d0d0d0;text-align:center;">{idx:02d}</td>')
            parts.append(f'<td style="padding:4px 8px;border:1px solid #d0d0d0;">{_esc(col.get("id", ""))}</td>')
            parts.append(f'<td style="padding:4px 8px;border:1px solid #d0d0d0;">{_esc(col.get("name", ""))}</td>')
            pk = col.get('primaryKey', 'false')
            if pk == 'true':
                parts.append(
                    '<td style="padding:4px 8px;border:1px solid #d0d0d0;">'
                    '<span style="color:#e17055;font-weight:bold;">true</span></td>')
            else:
                parts.append(f'<td style="padding:4px 8px;border:1px solid #d0d0d0;"></td>')
            t_type = col.get('type', '')
            t_size = col.get('size', '')
            type_display = _esc(t_type)
            if t_size:
                type_display += f'({_esc(t_size)})'
            parts.append(f'<td style="padding:4px 8px;border:1px solid #d0d0d0;">{type_display}</td>')
            parts.append(f'<td style="padding:4px 8px;border:1px solid #d0d0d0;">{_esc(col.get("enumValue", ""))}</td>')
            req = col.get('required', 'false')
            if req == 'true':
                parts.append(
                    '<td style="padding:4px 8px;border:1px solid #d0d0d0;">'
                    '<span style="color:#d63031;font-weight:bold;">true</span></td>')
            else:
                parts.append(f'<td style="padding:4px 8px;border:1px solid #d0d0d0;"></td>')
            parts.append(f'<td style="padding:4px 8px;border:1px solid #d0d0d0;">{_esc(col.get("default", ""))}</td>')
            parts.append(f'<td style="padding:4px 8px;border:1px solid #d0d0d0;">{_esc(col.get("format", ""))}</td>')
            parts.append(f'<td style="padding:4px 8px;border:1px solid #d0d0d0;">{_esc(col.get("inputsize", ""))}</td>')
            parts.append(f'<td style="padding:4px 8px;border:1px solid #d0d0d0;">{_esc(col.get("note", ""))}</td>')
            parts.append('</tr>')

        parts.append('</tbody></table></div>')
        return '\n'.join(parts)

    @staticmethod
    def _css():
        return '''<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
body {
    font-family: "Microsoft YaHei", "Segoe UI", sans-serif;
    font-size: 13px;
    color: #2d3436;
    margin: 0;
    padding: 16px 20px;
    background: #ffffff;
}
a { color: #0984e3; text-decoration: none; }
a:hover { text-decoration: underline; }
h2 { font-size: 22px; color: #2d3436; }
h5 { margin: 0; }
table { table-layout: fixed; }
th { font-size: 12px; }
td { font-size: 12px; }
</style></head>'''

    # ── Event handlers ────────────────────────────────────────

    def _on_tree_click(self, item, col, file_path):
        data = item.data(0, Qt.UserRole)
        if not data:
            return
        kind = data[0]
        if kind == 'table':
            table_id = data[1]
            idx = self.tab_widget.currentIndex()
            if idx < 0:
                return
            tab = self.tab_widget.widget(idx)

            # If in edit mode, update editor with the clicked table's XML
            if self.btn_edit_mode.isChecked():
                tab._viewing_table_id = table_id
                fp = tab._file_path
                try:
                    try:
                        with open(fp, 'r', encoding='utf-8') as f:
                            raw = f.read()
                    except UnicodeDecodeError:
                        with open(fp, 'r', encoding='gbk') as f:
                            raw = f.read()
                    tab_content = self._extract_table_xml(raw, table_id)
                    if tab_content:
                        tab._editing_table_id = table_id
                        tab._editor.setPlainText(tab_content)
                except Exception:
                    pass
                return

            self._scroll_to_table(table_id)

    def _scroll_to_table(self, table_id):
        """Show a single table's detail in the detail browser."""
        idx = self.tab_widget.currentIndex()
        if idx < 0:
            return
        tab = self.tab_widget.widget(idx)
        if not hasattr(tab, '_detail_browser'):
            return

        # Remember which table is being viewed (for edit mode scroll sync)
        tab._viewing_table_id = table_id

        fp = tab._file_path
        tables = self._file_tables.get(fp, [])
        target = None
        for t in tables:
            if t['id'] == table_id:
                target = t
                break
        if not target:
            return

        # Build a small HTML with just this one table's detail
        parts = [self._css(), '<body>']
        parts.append(
            '<div style="margin-bottom:12px;">'
            '<a href="#__back__" style="color:#0984e3;font-size:13px;text-decoration:none;">'
            '← 返回目录</a></div>'
        )
        parts.append(self._build_table_detail_html(target))
        parts.append('</body></html>')
        tab._detail_browser.setHtml('\n'.join(parts))
        tab._stack.setCurrentIndex(1)  # switch to detail view

    def _on_anchor_clicked(self, url):
        anchor = url.fragment()
        if anchor == '__back__':
            # Return to overview
            idx = self.tab_widget.currentIndex()
            if idx >= 0:
                tab = self.tab_widget.widget(idx)
                if hasattr(tab, '_stack'):
                    tab._stack.setCurrentIndex(0)
            return
        if anchor:
            browser = self.sender()
            if isinstance(browser, QTextBrowser):
                browser.scrollToAnchor(anchor)

    def _on_search(self, text):
        text_lower = text.strip().lower()
        idx = self.tab_widget.currentIndex()
        if idx < 0:
            return
        tab = self.tab_widget.widget(idx)
        if not hasattr(tab, '_tree'):
            return
        tree = tab._tree
        root = tree.invisibleRootItem()
        for i in range(root.childCount()):
            self._filter_item(root.child(i), text_lower)

    def _filter_item(self, item, query):
        child_count = item.childCount()
        if child_count == 0:
            if not query:
                item.setHidden(False)
                return True
            return query in item.text(0).lower()
        else:
            any_visible = False
            for i in range(child_count):
                if self._filter_item(item.child(i), query):
                    any_visible = True
            if not query:
                item.setHidden(False)
                return True
            item.setHidden(not any_visible)
            item.setExpanded(any_visible)
            return any_visible

    def closeEvent(self, event):
        self._save_session()
        super().closeEvent(event)
