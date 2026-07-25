"""Register XMLDatabaseViewer in Windows Open With / Default Apps list."""

import os
import sys
import winreg


PROG_ID = "XMLDatabaseViewer.xml"


def _get_exe_path():
    if getattr(sys, "frozen", False):
        return sys.executable
    return os.path.abspath(sys.argv[0])


def _write_reg(key_path, name, value):
    """Write a value to HKCU registry."""
    try:
        key = winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, key_path, 0, winreg.KEY_SET_VALUE)
        winreg.SetValueEx(key, name, 0, winreg.REG_SZ, value)
        winreg.CloseKey(key)
        return True
    except Exception:
        return False


def _register(exe_path):
    """Register the app via winreg. No shell, no quoting issues."""
    cmd = f'"{exe_path}" "%1"'

    entries = [
        # ProgID
        (r"Software\Classes\XMLDatabaseViewer.xml", "", "XML Database Viewer"),
        (r"Software\Classes\XMLDatabaseViewer.xml\DefaultIcon", "", f"{exe_path},0"),
        (r"Software\Classes\XMLDatabaseViewer.xml\shell\open\command", "", cmd),
        # Applications key (shows in Default Apps picker)
        (r"Software\Classes\Applications\XMLDatabaseViewer.exe", "ApplicationName", "XMLDatabaseViewer"),
        (r"Software\Classes\Applications\XMLDatabaseViewer.exe", "ApplicationDescription", "XML Database Viewer"),
        (r"Software\Classes\Applications\XMLDatabaseViewer.exe\DefaultIcon", "", f"{exe_path},0"),
        (r"Software\Classes\Applications\XMLDatabaseViewer.exe\shell\open\command", "", cmd),
        # OpenWithProgids
        (r"Software\Classes\.xml\OpenWithProgids", "XMLDatabaseViewer.xml", ""),
    ]

    ok = True
    for path, name, value in entries:
        if not _write_reg(path, name, value):
            ok = False
    return ok


def check_and_repair():
    """Check if the registered EXE path still matches. Re-register silently if moved."""
    if os.name != "nt" or not getattr(sys, "frozen", False):
        return

    current_exe = _get_exe_path()

    try:
        key = winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            r"Software\Classes\XMLDatabaseViewer.xml\shell\open\command"
        )
        value, _ = winreg.QueryValueEx(key, "(Default)")
        winreg.CloseKey(key)
    except (FileNotFoundError, OSError):
        value = None

    if value and current_exe.lower() in value.lower():
        return

    _register(current_exe)


def register_file_association(parent=None):
    """Register this app in Windows and open Default Apps settings."""
    from PyQt5.QtWidgets import QMessageBox

    if os.name != "nt":
        QMessageBox.information(parent, "提示", "文件关联仅支持 Windows 系统。")
        return False

    if not getattr(sys, "frozen", False):
        QMessageBox.information(parent, "提示", "文件关联功能需要在打包后的 EXE 中使用。")
        return False

    reply = QMessageBox.question(
        parent, "注册文件关联",
        "将本程序注册到 Windows「打开方式」列表中。\n\n"
        "注册后请在设置中选择本程序作为 .xml 的默认应用。",
        QMessageBox.Yes | QMessageBox.No,
    )
    if reply != QMessageBox.Yes:
        return False

    ok = _register(_get_exe_path())

    if ok:
        # Notify Explorer
        import subprocess
        try:
            subprocess.run(["ie4uinit.exe", "-show"], capture_output=True, timeout=5)
        except Exception:
            pass
        # Open Default Apps settings
        try:
            subprocess.Popen(["cmd", "/c", "start", "ms-settings:defaultapps"])
        except Exception:
            pass

        QMessageBox.information(
            parent, "注册完成",
            "已注册到 Windows「打开方式」列表。\n\n"
            "请在弹出的设置中：\n"
            "1. 点击「按文件类型指定默认应用」\n"
            "2. 找到 .xml\n"
            "3. 选择 XMLDatabaseViewer\n\n"
            "如果没有自动弹出设置，请手动打开：\n"
            "设置 → 应用 → 默认应用"
        )
    else:
        QMessageBox.warning(
            parent, "注册失败",
            "请手动设置：\n\n"
            "1. 右键 .xml 文件 → 属性 → 打开方式 → 更改\n"
            "2. 选择 XMLDatabaseViewer.exe\n"
            "3. 勾选「始终使用此应用打开 .xml 文件」"
        )
    return ok
