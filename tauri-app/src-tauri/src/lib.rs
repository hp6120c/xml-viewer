mod text;
mod xml;

use serde::Serialize;
use std::path::Path;
use std::sync::Mutex;
use tauri::{Emitter, Manager, State};
use text::MarkdownDocument;
use xml::{FileSource, TableSource, XmlDocument};

#[derive(Default)]
struct AppState {
    pending_paths: Mutex<Vec<String>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    version: String,
}

#[tauri::command]
fn get_app_info() -> AppInfo {
    AppInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
    }
}

#[tauri::command]
fn get_launch_paths(state: State<'_, AppState>) -> Vec<String> {
    let args: Vec<String> = std::env::args().collect();
    let cwd = std::env::current_dir().ok();
    let mut paths = text::document_paths_from_args(&args, cwd.as_deref());
    if let Ok(mut pending) = state.pending_paths.lock() {
        paths.append(&mut pending);
    }
    paths.sort();
    paths.dedup();
    paths
}

#[tauri::command]
fn load_xml_file(path: String) -> Result<XmlDocument, String> {
    xml::load_xml_file(Path::new(&path))
}

#[tauri::command]
fn scan_xml_files(folder: String) -> Result<Vec<String>, String> {
    xml::scan_xml_files(Path::new(&folder))
}

#[tauri::command]
fn scan_document_files(folder: String) -> Result<Vec<String>, String> {
    text::scan_document_files(Path::new(&folder))
}

#[tauri::command]
fn load_markdown_file(path: String) -> Result<MarkdownDocument, String> {
    text::load_markdown_file(Path::new(&path))
}

#[tauri::command]
fn save_markdown_file(
    path: String,
    new_source: String,
    expected_hash: String,
) -> Result<MarkdownDocument, String> {
    text::save_markdown_file(Path::new(&path), &new_source, &expected_hash)
}

#[tauri::command]
fn read_markdown_asset(document_path: String, asset_path: String) -> Result<String, String> {
    text::read_markdown_asset(Path::new(&document_path), &asset_path)
}

#[tauri::command]
fn get_table_source(
    path: String,
    table_index: usize,
    expected_id: String,
) -> Result<TableSource, String> {
    xml::get_table_source(Path::new(&path), table_index, &expected_id)
}

#[tauri::command]
fn get_file_source(path: String) -> Result<FileSource, String> {
    xml::get_file_source(Path::new(&path))
}

#[tauri::command]
fn save_table_source(
    path: String,
    table_index: usize,
    expected_id: String,
    new_source: String,
) -> Result<XmlDocument, String> {
    xml::save_table_source(Path::new(&path), table_index, &expected_id, &new_source)
}

#[tauri::command]
fn save_file_source(path: String, new_source: String) -> Result<XmlDocument, String> {
    xml::save_file_source(Path::new(&path), &new_source)
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn open_default_apps_settings() -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    std::process::Command::new("cmd")
        .args(["/C", "start", "", "ms-settings:defaultapps"])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("无法打开 Windows 默认应用设置: {e}"))
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn open_default_apps_settings() -> Result<(), String> {
    Err("文件关联设置仅支持 Windows".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            let paths = text::document_paths_from_args(&argv, Some(Path::new(&cwd)));
            if !paths.is_empty() {
                if let Some(state) = app.try_state::<AppState>() {
                    if let Ok(mut pending) = state.pending_paths.lock() {
                        pending.extend(paths.iter().cloned());
                    }
                }
                let _ = app.emit("open-files", paths);
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            get_app_info,
            get_launch_paths,
            load_xml_file,
            scan_xml_files,
            scan_document_files,
            load_markdown_file,
            save_markdown_file,
            read_markdown_asset,
            get_table_source,
            get_file_source,
            save_table_source,
            save_file_source,
            open_default_apps_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running XML Database Viewer");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_info_has_version() {
        assert!(!get_app_info().version.is_empty());
    }
}
