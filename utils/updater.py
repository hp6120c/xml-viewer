"""Auto-update: check GitHub Releases, download new EXE, replace via .bat script."""

import os
import sys
import json
import subprocess
from urllib.request import urlopen, Request

from PyQt5.QtCore import Qt, QThread, pyqtSignal
from PyQt5.QtWidgets import QMessageBox, QProgressDialog

REPO = "hp6120c/xml-viewer"
API_URL = f"https://api.github.com/repos/{REPO}/releases/latest"


def _parse_version(v):
    """Convert '1.3' or 'V1.3' to (1, 3)."""
    v = v.strip().lstrip("Vv")
    parts = v.split(".")
    return tuple(int(x) for x in parts[:2]) if len(parts) >= 2 else (0, 0)


def _check_for_update(current_version):
    """Check GitHub for latest release. Returns (tag, download_url, asset_name) or None."""
    try:
        req = Request(API_URL, headers={
            "Accept": "application/vnd.github.v3+json",
            "User-Agent": "XMLDatabaseViewer",
        })
        with urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))

        latest_tag = data.get("tag_name", "")
        if not latest_tag or _parse_version(latest_tag) <= _parse_version(current_version):
            return None

        for asset in data.get("assets", []):
            name = asset.get("name", "")
            if name.endswith(".exe") and "XMLDatabaseViewer" in name:
                return latest_tag, asset["browser_download_url"], name
        return None
    except Exception:
        return None


def _generate_bat(exe_dir, old_name, new_name, new_dl_path):
    """Create a .bat that waits for old process to exit, then replaces EXE and restarts."""
    bat_path = os.path.join(exe_dir, "_update.bat")
    with open(bat_path, "w", encoding="utf-8") as f:
        f.write(f"""@echo off
chcp 65001 >nul 2>&1
:WAIT
tasklist /FI "IMAGENAME eq {old_name}" 2>NUL | find /I "{old_name}" >NUL
if %ERRORLEVEL% == 0 (
    timeout /t 1 /nobreak >nul
    goto WAIT
)
if exist "{os.path.join(exe_dir, new_name)}" del "{os.path.join(exe_dir, new_name)}"
move /Y "{new_dl_path}" "{os.path.join(exe_dir, new_name)}" >nul 2>&1
start "" "{os.path.join(exe_dir, new_name)}"
del "%~f0"
""")
    return bat_path


def _download(url, dest, parent):
    """Download a file with a progress dialog. Returns True on success."""
    progress = QProgressDialog("正在下载更新...", "取消", 0, 100, parent)
    progress.setWindowTitle("下载更新")
    progress.setWindowModality(Qt.WindowModal)
    progress.setMinimumDuration(0)
    progress.setMinimumWidth(350)
    progress.setValue(0)

    error_msg = [None]

    try:
        req = Request(url, headers={"User-Agent": "XMLDatabaseViewer"})
        with urlopen(req, timeout=120) as resp:
            total = int(resp.headers.get("Content-Length", 0))
            downloaded = 0
            with open(dest, "wb") as f:
                while True:
                    if progress.wasCanceled():
                        return False
                    chunk = resp.read(64 * 1024)
                    if not chunk:
                        break
                    f.write(chunk)
                    downloaded += len(chunk)
                    if total > 0:
                        progress.setValue(int(downloaded * 100 / total))
    except Exception as e:
        error_msg[0] = str(e)

    progress.close()

    if error_msg[0]:
        QMessageBox.warning(parent, "下载失败", f"下载出错:\n{error_msg[0]}")
        if os.path.exists(dest):
            os.remove(dest)
        return False

    return True


def _do_replace_and_restart(exe_dir, old_name, new_name, dl_path, parent):
    """Generate .bat, launch it, and exit the app."""
    if not getattr(sys, "frozen", False):
        QMessageBox.information(parent, "更新完成",
                                f"已下载 {new_name} 到:\n{dl_path}\n\n请手动替换后重启。")
        return

    bat_path = _generate_bat(exe_dir, old_name, new_name, dl_path)
    flags = subprocess.CREATE_NO_WINDOW if hasattr(subprocess, "CREATE_NO_WINDOW") else 0
    subprocess.Popen(["cmd", "/c", bat_path], creationflags=flags)
    os._exit(0)


# ── Public API ────────────────────────────────────────────────


def check_and_update(parent, current_version):
    """Manual check from menu: blocking check, prompt, download, replace."""
    result = _check_for_update(current_version)
    if not result:
        QMessageBox.information(parent, "检查更新", "当前已是最新版本。")
        return

    latest_tag, url, asset_name = result
    reply = QMessageBox.question(
        parent, "发现新版本",
        f"发现新版本 {latest_tag}（当前 V{current_version}）\n\n是否立即更新？",
        QMessageBox.Yes | QMessageBox.No,
    )
    if reply != QMessageBox.Yes:
        return

    _download_and_replace(url, asset_name, current_version, parent)


def check_on_startup(parent, current_version):
    """Silent background check on startup. Only prompts if update available."""
    class _Checker(QThread):
        found = pyqtSignal(str, str, str)
        error = pyqtSignal()

        def run(self):
            r = _check_for_update(current_version)
            if r:
                self.found.emit(*r)
            else:
                self.error.emit()

    checker = _Checker()
    result_box = [None]

    def on_found(tag, url, name):
        result_box[0] = (tag, url, name)

    checker.found.connect(on_found)
    checker.start()
    checker.wait(12000)

    if result_box[0] is None:
        return

    latest_tag, url, asset_name = result_box[0]
    reply = QMessageBox.question(
        parent, "发现新版本",
        f"发现新版本 {latest_tag}（当前 V{current_version}）\n\n是否立即更新？",
        QMessageBox.Yes | QMessageBox.No,
    )
    if reply == QMessageBox.Yes:
        _download_and_replace(url, asset_name, current_version, parent)


def _download_and_replace(url, asset_name, current_version, parent):
    """Shared logic: download the new EXE and trigger replacement."""
    frozen = getattr(sys, "frozen", False)
    exe_dir = os.path.dirname(sys.executable) if frozen else os.getcwd()
    dl_path = os.path.join(exe_dir, f"_update_{asset_name}")

    if not _download(url, dl_path, parent):
        return

    if not os.path.exists(dl_path) or os.path.getsize(dl_path) < 100 * 1024:
        QMessageBox.warning(parent, "更新失败", "下载文件异常，请手动下载更新。")
        if os.path.exists(dl_path):
            os.remove(dl_path)
        return

    old_name = os.path.basename(sys.executable) if frozen else ""
    _do_replace_and_restart(exe_dir, old_name, asset_name, dl_path, parent)
