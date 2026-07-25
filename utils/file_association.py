"""Register XMLDatabaseViewer as the default XML file handler on Windows."""

import os
import sys
import ctypes
import subprocess
from winreg import HKEY_CURRENT_USER, HKEY_CLASSES_ROOT, REG_SZ, REG_DWORD


APP_NAME = "XMLDatabaseViewer"
APP_DESC = "XML 数据库设计查看器"
PROG_ID = "XMLDatabaseViewer.xml"

# Registry paths
USERCHOICE_KEY = r"Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.xml\UserChoice"


def _is_admin():
    """Check if running with admin privileges."""
    try:
        return ctypes.windll.shell32.IsUserAnAdmin()
    except Exception:
        return False


def _get_exe_path():
    """Get the absolute path to the running EXE or script."""
    if getattr(sys, "frozen", False):
        return sys.executable
    return os.path.abspath(sys.argv[0])


def _get_icon_path():
    """Icon path: same as EXE (uses its embedded icon)."""
    return _get_exe_path()


def _register_via_elevated_script():
    """Run a PowerShell script as admin to write registry entries."""
    exe = _get_exe_path()
    icon = _get_icon_path()

    # Build the PowerShell commands
    ps_commands = f"""
# Create ProgID
New-Item -Path "HKLM:\\Software\\Classes\\{PROG_ID}" -Force | Out-Null
Set-ItemProperty -Path "HKLM:\\Software\\Classes\\{PROG_ID}" -Name "(Default)" -Value "{APP_DESC}"
New-ItemProperty -Path "HKLM:\\Software\\Classes\\{PROG_ID}\\DefaultIcon" -Name "(Default)" -Value "{icon},0" -Force | Out-Null

# Create shell\\open\\command
New-Item -Path "HKLM:\\Software\\Classes\\{PROG_ID}\\shell\\open\\command" -Force | Out-Null
Set-ItemProperty -Path "HKLM:\\Software\\Classes\\{PROG_ID}\\shell\\open\\command" -Name "(Default)" -Value '\\\"{exe}\\\" \\\"%1\\\"'

# Register the ProgID for .xml
New-Item -Path "HKLM:\\Software\\Classes\\.xml\\OpenWithProgids" -Force | Out-Null
Set-ItemProperty -Path "HKLM:\\Software\\Classes\\.xml\\OpenWithProgids" -Name "{PROG_ID}" -Value ""

# Update UserChoice
New-Item -Path "HKCU:\\{USERCHOICE_KEY}" -Force | Out-Null
Set-ItemProperty -Path "HKCU:\\{USERCHOICE_KEY}" -Name "Progid" -Value "{PROG_ID}"
Set-ItemProperty -Path "HKCU:\\{USERCHOICE_KEY}" -Name "Hash" -Value ""

# Notify Explorer
$shell = New-Object -ComObject Shell.Application
$shell.ShellNotifyChange(0x8000000, 0x8000000)
"""

    # Write PS1 to temp file
    temp_ps = os.path.join(os.environ.get("TEMP", os.path.expanduser("~")), "_register_xml_viewer.ps1")
    with open(temp_ps, "w", encoding="utf-8") as f:
        f.write(ps_commands)

    # Elevate via PowerShell Start-Process
    ps_cmd = (
        f'Start-Process powershell -ArgumentList '
        f'"-ExecutionPolicy Bypass -File \\"{temp_ps}\\"" '
        f'-Verb RunAs -Wait'
    )
    temp_bat = os.path.join(os.environ.get("TEMP", os.path.expanduser("~")), "_register_xml_viewer.bat")
    with open(temp_bat, "w", encoding="utf-8") as f:
        f.write(f"@echo off\n{ps_cmd}\ndel \"%~f0\"\n")

    try:
        subprocess.Popen(["cmd", "/c", temp_bat], creationflags=0x08000000)  # CREATE_NO_WINDOW
        return True
    except Exception:
        return False


def register_file_association(parent=None):
    """Register this app as the default handler for .xml files.

    Shows a MessageBox for user feedback.
    """
    from PyQt5.QtWidgets import QMessageBox

    if os.name != "nt":
        QMessageBox.information(parent, "提示", "文件关联仅支持 Windows 系统。")
        return False

    if not getattr(sys, "frozen", False):
        QMessageBox.information(
            parent, "提示",
            "文件关联功能需要在打包后的 EXE 中使用。\n"
            "请先运行 python build.py 打包后再试。"
        )
        return False

    reply = QMessageBox.question(
        parent, "注册文件关联",
        "是否将本程序注册为 XML 文件的默认打开方式？\n\n"
        "注册后，双击 .xml 文件将自动用本程序打开。\n"
        "（需要管理员权限）",
        QMessageBox.Yes | QMessageBox.No,
    )
    if reply != QMessageBox.Yes:
        return False

    ok = _register_via_elevated_script()
    if ok:
        QMessageBox.information(
            parent, "注册成功",
            "文件关联已注册！\n\n"
            "请在 Windows 设置 → 默认应用 中确认，\n"
            "或重新双击 .xml 文件测试。"
        )
    else:
        QMessageBox.warning(
            parent, "注册失败",
            "无法启动管理员权限安装，请尝试手动设置：\n\n"
            "1. 右键 .xml 文件 → 属性 → 打开方式 → 更改\n"
            f"2. 选择 {APP_NAME}.exe"
        )
    return ok
