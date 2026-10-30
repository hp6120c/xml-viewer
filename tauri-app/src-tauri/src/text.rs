use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use encoding_rs::GB18030;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use tempfile::NamedTempFile;
use walkdir::WalkDir;

const UTF8_BOM: &[u8] = &[0xEF, 0xBB, 0xBF];
const UTF16_LE_BOM: &[u8] = &[0xFF, 0xFE];
const UTF16_BE_BOM: &[u8] = &[0xFE, 0xFF];
const MAX_MARKDOWN_ASSET_BYTES: u64 = 25 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownDocument {
    pub path: String,
    pub file_name: String,
    pub file_size: u64,
    pub encoding: String,
    pub kind: String,
    pub source: String,
    pub content_hash: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TextEncoding {
    Utf8,
    Utf16Le,
    Utf16Be,
    Gb18030,
}

impl TextEncoding {
    fn label(self) -> &'static str {
        match self {
            Self::Utf8 => "UTF-8",
            Self::Utf16Le => "UTF-16LE",
            Self::Utf16Be => "UTF-16BE",
            Self::Gb18030 => "GB18030",
        }
    }
}

struct DecodedText {
    text: String,
    encoding: TextEncoding,
    bom: Option<Vec<u8>>,
}

fn decode_utf16(bytes: &[u8], little_endian: bool) -> Result<String, String> {
    if !bytes.len().is_multiple_of(2) {
        return Err("UTF-16 文件字节长度无效".to_string());
    }
    let units = bytes
        .chunks_exact(2)
        .map(|pair| {
            if little_endian {
                u16::from_le_bytes([pair[0], pair[1]])
            } else {
                u16::from_be_bytes([pair[0], pair[1]])
            }
        })
        .collect::<Vec<_>>();
    String::from_utf16(&units).map_err(|_| "UTF-16 文件包含无效字符".to_string())
}

fn decode_text(path: &Path) -> Result<DecodedText, String> {
    let bytes = fs::read(path).map_err(|e| format!("读取文件失败: {e}"))?;

    if bytes.starts_with(UTF8_BOM) {
        let text = std::str::from_utf8(&bytes[UTF8_BOM.len()..])
            .map_err(|_| "UTF-8 文件包含无效字节".to_string())?
            .to_string();
        return Ok(DecodedText {
            text,
            encoding: TextEncoding::Utf8,
            bom: Some(UTF8_BOM.to_vec()),
        });
    }

    if bytes.starts_with(UTF16_LE_BOM) {
        return Ok(DecodedText {
            text: decode_utf16(&bytes[UTF16_LE_BOM.len()..], true)?,
            encoding: TextEncoding::Utf16Le,
            bom: Some(UTF16_LE_BOM.to_vec()),
        });
    }

    if bytes.starts_with(UTF16_BE_BOM) {
        return Ok(DecodedText {
            text: decode_utf16(&bytes[UTF16_BE_BOM.len()..], false)?,
            encoding: TextEncoding::Utf16Be,
            bom: Some(UTF16_BE_BOM.to_vec()),
        });
    }

    if let Ok(text) = std::str::from_utf8(&bytes) {
        return Ok(DecodedText {
            text: text.to_string(),
            encoding: TextEncoding::Utf8,
            bom: None,
        });
    }

    let (text, _, had_errors) = GB18030.decode(&bytes);
    if had_errors {
        return Err("文件不是有效的 UTF-8，且无法按 GB18030 解码".to_string());
    }
    Ok(DecodedText {
        text: text.into_owned(),
        encoding: TextEncoding::Gb18030,
        bom: None,
    })
}

fn encode_text(
    text: &str,
    encoding: TextEncoding,
    bom: &Option<Vec<u8>>,
) -> Result<Vec<u8>, String> {
    let mut output = bom.clone().unwrap_or_default();
    match encoding {
        TextEncoding::Utf8 => output.extend_from_slice(text.as_bytes()),
        TextEncoding::Utf16Le => {
            for unit in text.encode_utf16() {
                output.extend_from_slice(&unit.to_le_bytes());
            }
        }
        TextEncoding::Utf16Be => {
            for unit in text.encode_utf16() {
                output.extend_from_slice(&unit.to_be_bytes());
            }
        }
        TextEncoding::Gb18030 => {
            let (body, _, had_errors) = GB18030.encode(text);
            if had_errors {
                return Err("内容包含无法用 GB18030 编码保存的字符".to_string());
            }
            output.extend_from_slice(&body);
        }
    }
    Ok(output)
}

fn dominant_line_ending(original: &str) -> &'static str {
    let crlf = original.matches("\r\n").count();
    let lf = original.matches('\n').count().saturating_sub(crlf);
    if crlf > lf { "\r\n" } else { "\n" }
}

fn normalize_line_endings(content: &str, original: &str) -> String {
    let normalized = content.replace("\r\n", "\n").replace('\r', "\n");
    if dominant_line_ending(original) == "\r\n" {
        normalized.replace('\n', "\r\n")
    } else {
        normalized
    }
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "无法确定文件所在目录".to_string())?;
    let mut temp = NamedTempFile::new_in(parent).map_err(|e| format!("创建临时文件失败: {e}"))?;
    temp.write_all(bytes)
        .map_err(|e| format!("写入临时文件失败: {e}"))?;
    temp.as_file()
        .sync_all()
        .map_err(|e| format!("同步临时文件失败: {e}"))?;
    temp.persist(path)
        .map_err(|e| format!("替换原文件失败: {}", e.error))?;
    Ok(())
}

fn file_hash(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| format!("读取文件校验信息失败: {e}"))?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

fn build_document(path: &Path, decoded: DecodedText, content_hash: String) -> MarkdownDocument {
    MarkdownDocument {
        path: path.to_string_lossy().into_owned(),
        file_name: path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default(),
        file_size: fs::metadata(path)
            .map(|metadata| metadata.len())
            .unwrap_or(0),
        encoding: decoded.encoding.label().to_string(),
        kind: "markdown".to_string(),
        source: decoded.text,
        content_hash,
    }
}

fn is_markdown_path(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| {
            value.eq_ignore_ascii_case("md") || value.eq_ignore_ascii_case("markdown")
        })
}

fn is_document_path(path: &Path) -> bool {
    is_markdown_path(path)
        || path
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case("xml"))
}

fn markdown_asset_mime(path: &Path) -> Option<&'static str> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    match extension.as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "bmp" => Some("image/bmp"),
        "avif" => Some("image/avif"),
        _ => None,
    }
}

pub fn read_markdown_asset(document_path: &Path, asset_path: &str) -> Result<String, String> {
    let document = document_path
        .canonicalize()
        .map_err(|e| format!("文件不存在或无法访问: {e}"))?;
    if !is_markdown_path(&document) {
        return Err("Markdown 资源只能从 Markdown 文档中读取".to_string());
    }
    let base_directory = document
        .parent()
        .ok_or_else(|| "无法确定 Markdown 文件所在目录".to_string())?;

    let normalized_asset_path = asset_path.replace('/', "\\");
    if normalized_asset_path.starts_with("\\\\")
        || normalized_asset_path.starts_with("\\?\\")
        || normalized_asset_path.starts_with("\\\\.\\")
        || Path::new(asset_path).is_absolute()
        || normalized_asset_path
            .as_bytes()
            .get(1)
            .is_some_and(|value| *value == b':')
    {
        return Err("只允许加载当前 Markdown 文件目录内的相对图片".to_string());
    }

    let requested = PathBuf::from(asset_path);
    let candidate = if requested.is_absolute() {
        return Err("只允许加载当前 Markdown 文件目录内的相对图片".to_string());
    } else {
        base_directory.join(requested)
    };
    let asset = candidate
        .canonicalize()
        .map_err(|e| format!("图片不存在或无法访问: {e}"))?;
    if !asset.starts_with(base_directory) {
        return Err("图片路径超出当前 Markdown 文件目录".to_string());
    }
    let mime = markdown_asset_mime(&asset).ok_or_else(|| "不支持的图片格式".to_string())?;
    let metadata = fs::metadata(&asset).map_err(|e| format!("读取图片信息失败: {e}"))?;
    if metadata.len() > MAX_MARKDOWN_ASSET_BYTES {
        return Err("图片超过 25 MB，已拒绝加载".to_string());
    }
    let bytes = fs::read(&asset).map_err(|e| format!("读取图片失败: {e}"))?;
    Ok(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}

pub fn load_markdown_file(path: &Path) -> Result<MarkdownDocument, String> {
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("文件不存在或无法访问: {e}"))?;
    if !is_markdown_path(&canonical) {
        return Err("仅支持 .md 或 .markdown 文件".to_string());
    }
    let decoded = decode_text(&canonical)?;
    let content_hash = file_hash(&canonical)?;
    Ok(build_document(&canonical, decoded, content_hash))
}

pub fn save_markdown_file(
    path: &Path,
    new_source: &str,
    expected_hash: &str,
) -> Result<MarkdownDocument, String> {
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("文件不存在或无法访问: {e}"))?;
    if !is_markdown_path(&canonical) {
        return Err("仅支持 .md 或 .markdown 文件".to_string());
    }
    let current_hash = file_hash(&canonical)?;
    if current_hash != expected_hash {
        return Err("Markdown 文件已被其他程序修改，已阻止覆盖，请刷新后重试".to_string());
    }
    let decoded = decode_text(&canonical)?;
    let normalized = normalize_line_endings(new_source, &decoded.text);
    let bytes = encode_text(&normalized, decoded.encoding, &decoded.bom)?;
    atomic_write(&canonical, &bytes)?;
    let refreshed = decode_text(&canonical)?;
    let content_hash = file_hash(&canonical)?;
    Ok(build_document(&canonical, refreshed, content_hash))
}

pub fn scan_document_files(folder: &Path) -> Result<Vec<String>, String> {
    if !folder.is_dir() {
        return Err("文件夹不存在或无法访问".to_string());
    }
    let mut files = Vec::new();
    for entry in WalkDir::new(folder).follow_links(false).into_iter() {
        let Ok(entry) = entry else { continue };
        if entry.file_type().is_file() && is_document_path(entry.path()) {
            files.push(entry.path().to_string_lossy().into_owned());
        }
    }
    files.sort_by_cached_key(|value| value.to_lowercase());
    Ok(files)
}

pub fn create_document_file(path: &Path, kind: &str) -> Result<(), String> {
    let (content, expected_extension) = match kind {
        "markdown" => ("# 未命名文档\n\n", ["md", "markdown"].as_slice()),
        "xml" => (
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<root>\n</root>\n",
            ["xml"].as_slice(),
        ),
        _ => return Err("不支持的新建文件类型".to_string()),
    };
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if !expected_extension
        .iter()
        .any(|value| value.eq_ignore_ascii_case(extension))
    {
        return Err(format!(
            "新建文件扩展名必须为 {}",
            expected_extension.join(" / ")
        ));
    }
    if !path.is_absolute() {
        return Err("新建文件必须使用绝对路径".to_string());
    }
    let parent = path
        .parent()
        .ok_or_else(|| "无法确定新文件所在目录".to_string())?;
    if !parent.is_dir() {
        return Err("新文件所在目录不存在".to_string());
    }

    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|error| format!("创建文件失败（文件可能已存在）: {error}"))?;
    file.write_all(content.as_bytes())
        .map_err(|error| format!("写入新文件失败: {error}"))?;
    file.sync_all()
        .map_err(|error| format!("同步新文件失败: {error}"))?;
    Ok(())
}

pub fn document_paths_from_args(args: &[String], cwd: Option<&Path>) -> Vec<String> {
    let mut paths = Vec::new();
    for arg in args.iter().skip(1) {
        if arg.starts_with('-') {
            continue;
        }
        let raw_path = PathBuf::from(arg);
        let path = if raw_path.is_absolute() {
            raw_path
        } else if let Some(directory) = cwd {
            directory.join(raw_path)
        } else {
            raw_path
        };
        if path.is_file() && is_document_path(&path) {
            if let Ok(canonical) = path.canonicalize() {
                paths.push(canonical.to_string_lossy().into_owned());
            }
        }
    }
    paths.sort();
    paths.dedup();
    paths
}

#[cfg(test)]
mod tests {
    use super::*;

    fn utf16_bytes(text: &str, little_endian: bool) -> Vec<u8> {
        let mut bytes = if little_endian {
            UTF16_LE_BOM.to_vec()
        } else {
            UTF16_BE_BOM.to_vec()
        };
        for unit in text.encode_utf16() {
            if little_endian {
                bytes.extend_from_slice(&unit.to_le_bytes());
            } else {
                bytes.extend_from_slice(&unit.to_be_bytes());
            }
        }
        bytes
    }

    #[test]
    fn markdown_utf8_bom_round_trip_preserves_encoding_and_bom() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("说明.md");
        let mut bytes = UTF8_BOM.to_vec();
        bytes.extend_from_slice("# 标题\r\n\r\n内容\r\n".as_bytes());
        fs::write(&path, bytes).unwrap();

        let document = load_markdown_file(&path).unwrap();
        assert_eq!(document.kind, "markdown");
        assert_eq!(document.encoding, "UTF-8");
        assert_eq!(document.source, "# 标题\r\n\r\n内容\r\n");
        assert_eq!(document.content_hash.len(), 64);

        let saved = save_markdown_file(&path, "# 更新\n\n内容\n", &document.content_hash).unwrap();
        assert_eq!(saved.source, "# 更新\r\n\r\n内容\r\n");
        assert!(fs::read(&path).unwrap().starts_with(UTF8_BOM));
    }

    #[test]
    fn markdown_utf16_bom_round_trip_preserves_endianness() {
        let dir = tempfile::tempdir().unwrap();
        for (name, little_endian, expected_encoding) in [
            ("little.md", true, "UTF-16LE"),
            ("big.markdown", false, "UTF-16BE"),
        ] {
            let path = dir.path().join(name);
            fs::write(&path, utf16_bytes("# 中文内容\n", little_endian)).unwrap();
            let document = load_markdown_file(&path).unwrap();
            assert_eq!(document.encoding, expected_encoding);
            assert_eq!(document.source, "# 中文内容\n");

            save_markdown_file(&path, "# 已更新\n", &document.content_hash).unwrap();
            let bytes = fs::read(&path).unwrap();
            let expected_bom = if little_endian {
                UTF16_LE_BOM
            } else {
                UTF16_BE_BOM
            };
            assert!(bytes.starts_with(expected_bom));
            let decoded = decode_utf16(&bytes[expected_bom.len()..], little_endian).unwrap();
            assert_eq!(decoded, "# 已更新\n");
        }
    }

    #[test]
    fn markdown_non_utf8_chinese_falls_back_to_gb18030() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("旧文档.md");
        let (encoded, _, had_errors) = GB18030.encode("# 中文标题\n\n旧编码内容\n");
        assert!(!had_errors);
        fs::write(&path, encoded.as_ref()).unwrap();

        let document = load_markdown_file(&path).unwrap();
        assert_eq!(document.encoding, "GB18030");
        assert_eq!(document.source, "# 中文标题\n\n旧编码内容\n");

        save_markdown_file(&path, "# 更新内容\n", &document.content_hash).unwrap();
        let saved = fs::read(&path).unwrap();
        let (decoded, _, errors) = GB18030.decode(&saved);
        assert!(!errors);
        assert_eq!(decoded, "# 更新内容\n");
        assert!(!saved.starts_with(UTF8_BOM));
    }

    #[test]
    fn markdown_save_rejects_external_modification() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("conflict.md");
        fs::write(&path, "# Original\n").unwrap();
        let document = load_markdown_file(&path).unwrap();
        fs::write(&path, "# Changed by another editor\n").unwrap();

        let error = save_markdown_file(&path, "# My edit\n", &document.content_hash).unwrap_err();
        assert!(error.contains("其他程序修改"));
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            "# Changed by another editor\n"
        );
    }

    #[test]
    fn creates_new_markdown_and_xml_files_without_overwriting() {
        let dir = tempfile::tempdir().unwrap();
        let markdown = dir.path().join("new.md");
        let xml = dir.path().join("new.xml");
        create_document_file(&markdown, "markdown").unwrap();
        create_document_file(&xml, "xml").unwrap();
        assert!(
            fs::read_to_string(&markdown)
                .unwrap()
                .starts_with("# 未命名文档")
        );
        assert!(fs::read_to_string(&xml).unwrap().contains("<root>"));
        assert!(create_document_file(&markdown, "markdown").is_err());
    }

    #[test]
    fn scan_document_files_recurses_and_filters_extensions() {
        let dir = tempfile::tempdir().unwrap();
        let nested = dir.path().join("nested");
        fs::create_dir(&nested).unwrap();
        fs::write(dir.path().join("root.XML"), "<root />").unwrap();
        fs::write(dir.path().join("readme.md"), "# Readme").unwrap();
        fs::write(nested.join("guide.markdown"), "# Guide").unwrap();
        fs::write(nested.join("ignored.txt"), "ignored").unwrap();

        let files = scan_document_files(dir.path()).unwrap();
        assert_eq!(files.len(), 3);
        assert!(files.iter().any(|path| path.ends_with("root.XML")));
        assert!(files.iter().any(|path| path.ends_with("readme.md")));
        assert!(files.iter().any(|path| path.ends_with("guide.markdown")));
        assert!(!files.iter().any(|path| path.ends_with("ignored.txt")));
    }

    #[test]
    fn command_line_accepts_xml_and_markdown_only() {
        let dir = tempfile::tempdir().unwrap();
        let xml = dir.path().join("schema.xml");
        let md = dir.path().join("readme.md");
        let markdown = dir.path().join("guide.markdown");
        let ignored = dir.path().join("notes.txt");
        for path in [&xml, &md, &markdown, &ignored] {
            fs::write(path, "content").unwrap();
        }

        let args = vec![
            "viewer.exe".to_string(),
            xml.to_string_lossy().into_owned(),
            md.to_string_lossy().into_owned(),
            markdown.to_string_lossy().into_owned(),
            ignored.to_string_lossy().into_owned(),
        ];
        let paths = document_paths_from_args(&args, None);
        assert_eq!(paths.len(), 3);
        assert!(!paths.iter().any(|path| path.ends_with("notes.txt")));
    }

    #[test]
    fn command_line_resolves_relative_paths_against_second_instance_cwd() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("readme.md"), "# Readme").unwrap();
        let args = vec!["viewer.exe".to_string(), "readme.md".to_string()];

        let paths = document_paths_from_args(&args, Some(dir.path()));
        assert_eq!(paths.len(), 1);
        assert!(paths[0].ends_with("readme.md"));
    }

    #[test]
    fn markdown_asset_is_limited_to_document_directory() {
        let parent = tempfile::tempdir().unwrap();
        let docs = parent.path().join("docs");
        let outside = parent.path().join("outside");
        fs::create_dir(&docs).unwrap();
        fs::create_dir(&outside).unwrap();
        let document = docs.join("readme.md");
        let image = docs.join("image.png");
        let outside_image = outside.join("secret.png");
        fs::write(&document, "# Doc").unwrap();
        fs::write(&image, [0x89, b'P', b'N', b'G']).unwrap();
        fs::write(&outside_image, [0x89, b'P', b'N', b'G']).unwrap();

        let data_url = read_markdown_asset(&document, "image.png").unwrap();
        assert!(data_url.starts_with("data:image/png;base64,"));
        assert!(read_markdown_asset(&document, "../outside/secret.png").is_err());
        assert!(read_markdown_asset(&document, r"\\server\share\secret.png").is_err());
        assert!(read_markdown_asset(&document, r"C:\Windows\secret.png").is_err());
    }
}
