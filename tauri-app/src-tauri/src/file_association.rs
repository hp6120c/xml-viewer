#[cfg(target_os = "windows")]
use std::path::Path;

#[cfg(target_os = "windows")]
use std::fs;

#[cfg(target_os = "windows")]
use winreg::enums::HKEY_CURRENT_USER;

#[cfg(target_os = "windows")]
use winreg::RegKey;

#[cfg(target_os = "windows")]
const APP_KEY: &str = r"Software\Classes\Applications\xml-database-viewer.exe";

#[cfg(target_os = "windows")]
const XML_PROG_ID: &str = "XML Database Design";

#[cfg(target_os = "windows")]
const MARKDOWN_PROG_ID: &str = "Markdown Document";

#[cfg(target_os = "windows")]
fn registry_error(context: &str, error: impl std::fmt::Display) -> String {
    format!("{context}: {error}")
}

#[cfg(target_os = "windows")]
fn installed_executable(hkcu: &RegKey) -> Option<std::path::PathBuf> {
    let uninstall = hkcu
        .open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Uninstall\XML Markdown 编辑器")
        .ok()?;
    let install_location: String = uninstall.get_value("InstallLocation").ok()?;
    let install_location = install_location.trim().trim_matches('"');
    let executable = std::path::PathBuf::from(install_location).join("xml-database-viewer.exe");
    executable.is_file().then_some(executable)
}

#[cfg(target_os = "windows")]
fn register_prog_id(hkcu: &RegKey, prog_id: &str, executable: &Path) -> Result<(), String> {
    let (prog_key, _) = hkcu
        .create_subkey(format!(r"Software\Classes\{prog_id}"))
        .map_err(|error| registry_error("创建文件类型 ProgID 失败", error))?;
    prog_key
        .set_value("", &prog_id)
        .map_err(|error| registry_error("写入 ProgID 失败", error))?;

    let (icon_key, _) = prog_key
        .create_subkey("DefaultIcon")
        .map_err(|error| registry_error("创建 ProgID 图标项失败", error))?;
    icon_key
        .set_value("", &format!("{},0", executable.display()))
        .map_err(|error| registry_error("写入 ProgID 图标失败", error))?;

    let (open_key, _) = prog_key
        .create_subkey(r"shell\open")
        .map_err(|error| registry_error("创建 ProgID 打开项失败", error))?;
    open_key
        .set_value("", &"使用 XML / Markdown 编辑器打开")
        .map_err(|error| registry_error("写入 ProgID 打开说明失败", error))?;

    let (command_key, _) = open_key
        .create_subkey("command")
        .map_err(|error| registry_error("创建 ProgID 命令项失败", error))?;
    command_key
        .set_value("", &format!("\"{}\" \"%1\"", executable.display()))
        .map_err(|error| registry_error("写入 ProgID 打开命令失败", error))?;
    Ok(())
}

/// Registers the current executable as a Windows default-app candidate.
///
/// This intentionally does not write a UserChoice hash. Windows requires the
/// user to choose the default application in Settings or the Open With dialog.
#[cfg(target_os = "windows")]
pub fn register_file_associations() -> Result<(), String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let executable = installed_executable(&hkcu)
        .or_else(|| std::env::current_exe().ok())
        .ok_or_else(|| "获取程序路径失败".to_string())?
        .canonicalize()
        .map_err(|error| format!("解析程序路径失败: {error}"))?;
    fs::metadata(&executable).map_err(|error| format!("读取程序文件失败: {error}"))?;

    let (app_key, _) = hkcu
        .create_subkey(APP_KEY)
        .map_err(|error| registry_error("创建应用注册项失败", error))?;
    app_key
        .set_value("FriendlyAppName", &"XML / Markdown 编辑器")
        .map_err(|error| registry_error("写入应用名称失败", error))?;
    app_key
        .set_value("ApplicationCompany", &"hp6120c")
        .map_err(|error| registry_error("写入应用发布者失败", error))?;

    let (icon_key, _) = app_key
        .create_subkey("DefaultIcon")
        .map_err(|error| registry_error("创建应用图标项失败", error))?;
    icon_key
        .set_value("", &format!("{},0", executable.display()))
        .map_err(|error| registry_error("写入应用图标失败", error))?;

    let (command_key, _) = app_key
        .create_subkey(r"shell\open\command")
        .map_err(|error| registry_error("创建应用打开命令失败", error))?;
    command_key
        .set_value("", &format!("\"{}\" \"%1\"", executable.display()))
        .map_err(|error| registry_error("写入应用打开命令失败", error))?;

    let (capabilities_key, _) = app_key
        .create_subkey("Capabilities")
        .map_err(|error| registry_error("创建应用能力项失败", error))?;
    capabilities_key
        .set_value("ApplicationName", &"XML / Markdown 编辑器")
        .map_err(|error| registry_error("写入应用能力名称失败", error))?;
    capabilities_key
        .set_value(
            "ApplicationDescription",
            &"XML 数据库设计和 Markdown 文档编辑器",
        )
        .map_err(|error| registry_error("写入应用能力描述失败", error))?;
    capabilities_key
        .set_value("ApplicationIcon", &format!("{},0", executable.display()))
        .map_err(|error| registry_error("写入应用能力图标失败", error))?;

    let (associations_key, _) = capabilities_key
        .create_subkey("FileAssociations")
        .map_err(|error| registry_error("创建文件关联能力项失败", error))?;
    associations_key
        .set_value(".xml", &XML_PROG_ID)
        .map_err(|error| registry_error("注册 XML 能力失败", error))?;
    associations_key
        .set_value(".md", &MARKDOWN_PROG_ID)
        .map_err(|error| registry_error("注册 Markdown 能力失败", error))?;
    associations_key
        .set_value(".markdown", &MARKDOWN_PROG_ID)
        .map_err(|error| registry_error("注册 Markdown 扩展名能力失败", error))?;

    let (registered_apps, _) = hkcu
        .create_subkey(r"Software\RegisteredApplications")
        .map_err(|error| registry_error("创建默认应用注册表失败", error))?;
    registered_apps
        .set_value("XMLMarkdownViewer", &format!(r"{APP_KEY}\Capabilities"))
        .map_err(|error| registry_error("注册默认应用能力失败", error))?;

    register_prog_id(&hkcu, XML_PROG_ID, &executable)?;
    register_prog_id(&hkcu, MARKDOWN_PROG_ID, &executable)?;

    let (classes_key, _) = hkcu
        .create_subkey(r"Software\Classes")
        .map_err(|error| registry_error("打开 Classes 注册表失败", error))?;
    for (extension, prog_id, content_type) in [
        (".xml", XML_PROG_ID, "application/xml"),
        (".md", MARKDOWN_PROG_ID, "text/markdown"),
        (".markdown", MARKDOWN_PROG_ID, "text/markdown"),
    ] {
        let (extension_key, _) = classes_key
            .create_subkey(extension)
            .map_err(|error| registry_error("创建扩展名注册项失败", error))?;
        extension_key
            .set_value("", &prog_id)
            .map_err(|error| registry_error("写入扩展名 ProgID 失败", error))?;
        extension_key
            .set_value("Content Type", &content_type)
            .map_err(|error| registry_error("写入扩展名 MIME 类型失败", error))?;
    }

    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn register_file_associations() -> Result<(), String> {
    Err("文件关联注册仅支持 Windows".to_string())
}
