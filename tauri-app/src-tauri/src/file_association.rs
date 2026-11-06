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
const CSV_PROG_ID: &str = "CSV Document";

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
fn windows_shell_path(path: &std::path::Path) -> Result<String, String> {
    use std::ffi::OsString;
    use std::path::{Component, Prefix};

    let Some(Component::Prefix(prefix)) = path.components().next() else {
        return path
            .to_str()
            .map(str::to_owned)
            .ok_or_else(|| "程序路径包含无法转换为字符串的字符".to_string());
    };

    let suffix = path.strip_prefix(prefix.as_os_str()).unwrap_or(path);
    let mut simplified = OsString::new();

    match prefix.kind() {
        Prefix::VerbatimDisk(drive) => {
            simplified.push(format!("{}:", drive as char));
            simplified.push(suffix);
        }
        Prefix::VerbatimUNC(server, share) => {
            simplified.push(r"\\");
            simplified.push(server);
            simplified.push(r"\");
            simplified.push(share);
            simplified.push(suffix);
        }
        _ => simplified.push(path.as_os_str()),
    }

    simplified
        .into_string()
        .map_err(|_| "程序路径包含无法写入注册表的字符".to_string())
}

#[cfg(target_os = "windows")]
fn register_prog_id(hkcu: &RegKey, prog_id: &str, executable: &str) -> Result<(), String> {
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
        .set_value("", &format!("{executable},0"))
        .map_err(|error| registry_error("写入 ProgID 图标失败", error))?;

    let (open_key, _) = prog_key
        .create_subkey(r"shell\open")
        .map_err(|error| registry_error("创建 ProgID 打开项失败", error))?;
    open_key
        .set_value("", &"使用 XML / Markdown / CSV 编辑器打开")
        .map_err(|error| registry_error("写入 ProgID 打开说明失败", error))?;

    let (command_key, _) = open_key
        .create_subkey("command")
        .map_err(|error| registry_error("创建 ProgID 命令项失败", error))?;
    command_key
        .set_value("", &format!("\"{executable}\" \"%1\""))
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
    let executable_path = installed_executable(&hkcu)
        .or_else(|| std::env::current_exe().ok())
        .ok_or_else(|| "获取程序路径失败".to_string())?
        .canonicalize()
        .map_err(|error| format!("解析程序路径失败: {error}"))?;
    fs::metadata(&executable_path).map_err(|error| format!("读取程序文件失败: {error}"))?;
    let executable = windows_shell_path(&executable_path)?;

    let (app_key, _) = hkcu
        .create_subkey(APP_KEY)
        .map_err(|error| registry_error("创建应用注册项失败", error))?;
    app_key
        .set_value("FriendlyAppName", &"XML / Markdown / CSV 编辑器")
        .map_err(|error| registry_error("写入应用名称失败", error))?;
    app_key
        .set_value("ApplicationCompany", &"hp6120c")
        .map_err(|error| registry_error("写入应用发布者失败", error))?;

    let (icon_key, _) = app_key
        .create_subkey("DefaultIcon")
        .map_err(|error| registry_error("创建应用图标项失败", error))?;
    icon_key
        .set_value("", &format!("{executable},0"))
        .map_err(|error| registry_error("写入应用图标失败", error))?;

    let (command_key, _) = app_key
        .create_subkey(r"shell\open\command")
        .map_err(|error| registry_error("创建应用打开命令失败", error))?;
    command_key
        .set_value("", &format!("\"{executable}\" \"%1\""))
        .map_err(|error| registry_error("写入应用打开命令失败", error))?;

    let (capabilities_key, _) = app_key
        .create_subkey("Capabilities")
        .map_err(|error| registry_error("创建应用能力项失败", error))?;
    capabilities_key
        .set_value("ApplicationName", &"XML / Markdown / CSV 编辑器")
        .map_err(|error| registry_error("写入应用能力名称失败", error))?;
    capabilities_key
        .set_value("ApplicationDescription", &"XML、Markdown 和 CSV 文档编辑器")
        .map_err(|error| registry_error("写入应用能力描述失败", error))?;
    capabilities_key
        .set_value("ApplicationIcon", &format!("{executable},0"))
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
    associations_key
        .set_value(".csv", &CSV_PROG_ID)
        .map_err(|error| registry_error("注册 CSV 能力失败", error))?;

    let (registered_apps, _) = hkcu
        .create_subkey(r"Software\RegisteredApplications")
        .map_err(|error| registry_error("创建默认应用注册表失败", error))?;
    registered_apps
        .set_value("XMLMarkdownViewer", &format!(r"{APP_KEY}\Capabilities"))
        .map_err(|error| registry_error("注册默认应用能力失败", error))?;

    register_prog_id(&hkcu, XML_PROG_ID, &executable)?;
    register_prog_id(&hkcu, MARKDOWN_PROG_ID, &executable)?;
    register_prog_id(&hkcu, CSV_PROG_ID, &executable)?;

    let (classes_key, _) = hkcu
        .create_subkey(r"Software\Classes")
        .map_err(|error| registry_error("打开 Classes 注册表失败", error))?;
    for (extension, prog_id, content_type) in [
        (".xml", XML_PROG_ID, "application/xml"),
        (".md", MARKDOWN_PROG_ID, "text/markdown"),
        (".markdown", MARKDOWN_PROG_ID, "text/markdown"),
        (".csv", CSV_PROG_ID, "text/csv"),
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

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::windows_shell_path;
    use std::path::Path;

    #[test]
    fn shell_path_removes_extended_drive_prefix() {
        assert_eq!(
            windows_shell_path(Path::new(
                r"\\?\C:\Users\Austin\AppData\Local\XML Markdown 编辑器\xml-database-viewer.exe"
            ))
            .unwrap(),
            r"C:\Users\Austin\AppData\Local\XML Markdown 编辑器\xml-database-viewer.exe"
        );
    }

    #[test]
    fn shell_path_converts_extended_unc_prefix() {
        assert_eq!(
            windows_shell_path(Path::new(
                r"\\?\UNC\server\share\XML Markdown 编辑器\xml-database-viewer.exe"
            ))
            .unwrap(),
            r"\\server\share\XML Markdown 编辑器\xml-database-viewer.exe"
        );
    }

    #[test]
    fn shell_path_keeps_regular_path_unchanged() {
        assert_eq!(
            windows_shell_path(Path::new(
                r"C:\Users\Austin\AppData\Local\XML Markdown 编辑器\xml-database-viewer.exe"
            ))
            .unwrap(),
            r"C:\Users\Austin\AppData\Local\XML Markdown 编辑器\xml-database-viewer.exe"
        );
    }

    #[test]
    fn shell_path_keeps_regular_unc_path_unchanged() {
        assert_eq!(
            windows_shell_path(Path::new(
                r"\\server\share\XML Markdown 编辑器\xml-database-viewer.exe"
            ))
            .unwrap(),
            r"\\server\share\XML Markdown 编辑器\xml-database-viewer.exe"
        );
    }

    #[test]
    fn shell_path_does_not_mangle_volume_guid_path() {
        let path = Path::new(
            r"\\?\Volume{01234567-89ab-cdef-0123-456789abcdef}\XML Markdown 编辑器\xml-database-viewer.exe",
        );
        assert_eq!(windows_shell_path(path).unwrap(), path.to_string_lossy());
    }
}
