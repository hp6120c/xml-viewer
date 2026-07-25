import sys
import os
from PyQt5.QtWidgets import QApplication
from PyQt5.QtCore import Qt
from PyQt5.QtGui import QFont

# 添加当前目录到Python路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# 设置Qt平台插件路径
def setup_qt_plugin_path():
    """设置Qt平台插件路径"""
    # 获取当前脚本所在目录
    script_dir = os.path.dirname(os.path.abspath(__file__))
    
    # 尝试多种可能的路径
    possible_paths = [
        # 虚拟环境中的路径
        os.path.join(script_dir, ".venv", "Lib", "site-packages", "PyQt5", "Qt5", "plugins", "platforms"),
        # 系统安装的路径
        os.path.join(os.path.expanduser("~"), "AppData", "Local", "Programs", "Python", "Python312", "Lib", "site-packages", "PyQt5", "Qt5", "plugins", "platforms"),
        # 其他可能的路径
        os.path.join(sys.prefix, "Lib", "site-packages", "PyQt5", "Qt5", "plugins", "platforms"),
    ]
    
    for path in possible_paths:
        if os.path.exists(path):
            os.environ["QT_QPA_PLATFORM_PLUGIN_PATH"] = path
            return
    
    # 如果都没找到，尝试从PyQt5模块推断
    try:
        import PyQt5
        pyqt5_dir = os.path.dirname(PyQt5.__file__)
        qt5_dir = os.path.join(pyqt5_dir, "Qt5")
        plugins_dir = os.path.join(qt5_dir, "plugins")
        platforms_dir = os.path.join(plugins_dir, "platforms")
        if os.path.exists(platforms_dir):
            os.environ["QT_QPA_PLATFORM_PLUGIN_PATH"] = platforms_dir
    except:
        pass

# 设置Qt插件路径
setup_qt_plugin_path()

from ui.main_window import MainWindow

def main():
    """主函数"""
    # 设置高DPI支持
    QApplication.setAttribute(Qt.AA_EnableHighDpiScaling, True)
    QApplication.setAttribute(Qt.AA_UseHighDpiPixmaps, True)
    
    # 创建应用
    app = QApplication(sys.argv)
    
    # 设置应用字体
    font = QFont("微软雅黑", 10)
    app.setFont(font)
    
    # 设置应用样式
    app.setStyle("Fusion")
    
    # 创建主窗口
    window = MainWindow()
    window.show()
    
    # 运行应用
    sys.exit(app.exec_())

if __name__ == "__main__":
    main()