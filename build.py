import subprocess
import os
import shutil
import sys

def build_exe():
    print("=" * 50)
    print("  XML数据库设计查看器 - 打包工具")
    print("=" * 50)

    script_dir = os.path.dirname(os.path.abspath(__file__))
    build_dir = r"C:\xml_viewer_build"
    venv_python = os.path.join(build_dir, ".venv", "Scripts", "python.exe")
    venv_pip = os.path.join(build_dir, ".venv", "Scripts", "pip.exe")

    # Step 1: 复制项目文件（跳过已有内容，仅更新源码）
    print("\n[1/4] 正在同步项目文件...")
    if not os.path.exists(build_dir):
        print("  首次构建，复制全部文件...")
        shutil.copytree(script_dir, build_dir,
                        ignore=shutil.ignore_patterns('.venv', 'build', 'dist', '__pycache__', '*.pyc'))
    else:
        print("  构建目录已存在，仅更新源码文件...")
        for name in ['main.py', 'requirements.txt', 'run.bat', 'README.txt']:
            src = os.path.join(script_dir, name)
            if os.path.exists(src):
                shutil.copy2(src, os.path.join(build_dir, name))
        for folder in ['ui', 'utils']:
            src_dir = os.path.join(script_dir, folder)
            dst_dir = os.path.join(build_dir, folder)
            if os.path.exists(src_dir):
                os.makedirs(dst_dir, exist_ok=True)
                for fname in os.listdir(src_dir):
                    if fname.endswith('.py'):
                        shutil.copy2(os.path.join(src_dir, fname), os.path.join(dst_dir, fname))
    print(f"  同步完成: {build_dir}")

    # Step 2: 创建虚拟环境（如不存在）
    print("\n[2/4] 检查虚拟环境...")
    if not os.path.exists(venv_python):
        print("  创建虚拟环境...")
        subprocess.run([sys.executable, "-m", "venv", os.path.join(build_dir, ".venv")], check=True)
        print("  安装依赖...")
        subprocess.run([venv_pip, "install", "PyQt5", "pyinstaller",
                        "-i", "https://pypi.tuna.tsinghua.edu.cn/simple"], check=True)
    else:
        print("  虚拟环境已存在，检查依赖...")
        # 确保 PyQt5 和 PyInstaller 已安装
        check_pyqt = subprocess.run([venv_python, "-c", "import PyQt5"],
                                     capture_output=True)
        check_pi = subprocess.run([venv_python, "-c", "import PyInstaller"],
                                   capture_output=True)
        if check_pyqt.returncode != 0 or check_pi.returncode != 0:
            pkgs = []
            if check_pyqt.returncode != 0:
                pkgs.append("PyQt5")
            if check_pi.returncode != 0:
                pkgs.append("pyinstaller")
            print(f"  安装: {', '.join(pkgs)}...")
            subprocess.run([venv_pip, "install"] + pkgs +
                           ["-i", "https://pypi.tuna.tsinghua.edu.cn/simple"], check=True)

    # Step 3: 清理旧构建
    print("\n[3/4] 清理旧构建...")
    dist_dir = os.path.join(build_dir, "dist")
    build_subdir = os.path.join(build_dir, "build")
    if os.path.exists(dist_dir):
        shutil.rmtree(dist_dir)
    if os.path.exists(build_subdir):
        shutil.rmtree(build_subdir)
    # 清理 spec 文件
    for f in os.listdir(build_dir):
        if f.endswith('.spec'):
            os.remove(os.path.join(build_dir, f))

    # Step 4: 打包
    print("\n[4/4] 正在打包（可能需要几分钟）...")
    exe_name = "XMLDatabaseViewer"
    cmd = [
        venv_python, "-m", "PyInstaller",
        os.path.join(build_dir, "main.py"),
        f"--name={exe_name}",
        "--windowed",
        "--onefile",
        "--icon=NONE",
        f"--distpath={dist_dir}",
        f"--workpath={build_subdir}",
        "--clean",
        "--noconfirm",
        "--hidden-import", "PyQt5.QtWidgets",
        "--hidden-import", "PyQt5.QtCore",
        "--hidden-import", "PyQt5.QtGui",
        "--hidden-import", "PyQt5.sip",
    ]

    result = subprocess.run(cmd)

    if result.returncode != 0:
        print("\n打包失败！请检查上方错误信息。")
        return False

    # 复制 exe 到项目目录
    exe_path = os.path.join(dist_dir, f"{exe_name}.exe")
    if os.path.exists(exe_path):
        target_dir = os.path.join(script_dir, "dist")
        os.makedirs(target_dir, exist_ok=True)
        target_exe = os.path.join(target_dir, "XML数据库设计查看器.exe")
        shutil.copy2(exe_path, target_exe)
        size_mb = os.path.getsize(target_exe) / (1024 * 1024)
        print(f"\n{'=' * 50}")
        print(f"  打包成功！")
        print(f"  文件: {target_exe}")
        print(f"  大小: {size_mb:.2f} MB")
        print(f"{'=' * 50}")
    else:
        print(f"\n打包完成，但未找到exe文件")
        return False

    # 清理临时构建文件（保留 venv 加速下次构建）
    for name in ['build', 'dist']:
        p = os.path.join(build_dir, name)
        if os.path.exists(p):
            shutil.rmtree(p, ignore_errors=True)
    for f in os.listdir(build_dir):
        if f.endswith('.spec'):
            os.remove(os.path.join(build_dir, f))

    return True

if __name__ == "__main__":
    build_exe()
