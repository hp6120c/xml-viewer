use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use encoding_rs::{BIG5, GB18030, GBK};
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvDocument {
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
    Gbk,
    Big5,
}

impl TextEncoding {
    fn label(self) -> &'static str {
        match self {
            Self::Utf8 => "UTF-8",
            Self::Utf16Le => "UTF-16LE",
            Self::Utf16Be => "UTF-16BE",
            Self::Gb18030 => "GB18030",
            Self::Gbk => "GBK",
            Self::Big5 => "BIG5",
        }
    }

    fn from_normalized(value: &str) -> Option<Self> {
        match value {
            "UTF8" => Some(Self::Utf8),
            "UTF16LE" => Some(Self::Utf16Le),
            "UTF16BE" => Some(Self::Utf16Be),
            "GB18030" => Some(Self::Gb18030),
            "GBK" => Some(Self::Gbk),
            "BIG5" => Some(Self::Big5),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct EncodingSelection {
    encoding: TextEncoding,
    utf8_bom: bool,
}

impl EncodingSelection {
    fn parse(label: &str) -> Option<Self> {
        let normalized = label
            .chars()
            .filter(|value| value.is_ascii_alphanumeric())
            .collect::<String>()
            .to_ascii_uppercase();
        if normalized == "UTF8BOM" {
            return Some(Self {
                encoding: TextEncoding::Utf8,
                utf8_bom: true,
            });
        }
        TextEncoding::from_normalized(&normalized).map(|encoding| Self {
            encoding,
            utf8_bom: false,
        })
    }

    fn display_label(self) -> &'static str {
        if self.encoding == TextEncoding::Utf8 && self.utf8_bom {
            "UTF-8 BOM"
        } else {
            self.encoding.label()
        }
    }
}

struct DecodedText {
    text: String,
    encoding: TextEncoding,
    bom: Option<Vec<u8>>,
}

impl DecodedText {
    fn encoding_label(&self) -> &'static str {
        if self.encoding == TextEncoding::Utf8 && self.bom.is_some() {
            "UTF-8 BOM"
        } else {
            self.encoding.label()
        }
    }
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

fn decode_selected(bytes: &[u8], selection: EncodingSelection) -> Result<DecodedText, String> {
    let label = selection.display_label();
    let has_utf8_bom = bytes.starts_with(UTF8_BOM);
    let has_utf16_le_bom = bytes.starts_with(UTF16_LE_BOM);
    let has_utf16_be_bom = bytes.starts_with(UTF16_BE_BOM);
    match selection.encoding {
        TextEncoding::Utf8 if has_utf16_le_bom || has_utf16_be_bom => {
            return Err(format!("CSV 文件包含 UTF-16 BOM，不能按 {label} 解码"));
        }
        TextEncoding::Utf16Le if has_utf8_bom || has_utf16_be_bom => {
            return Err(format!("CSV 文件 BOM 与 {label} 编码不匹配"));
        }
        TextEncoding::Utf16Be if has_utf8_bom || has_utf16_le_bom => {
            return Err(format!("CSV 文件 BOM 与 {label} 编码不匹配"));
        }
        TextEncoding::Gb18030 | TextEncoding::Gbk | TextEncoding::Big5
            if has_utf8_bom || has_utf16_le_bom || has_utf16_be_bom =>
        {
            return Err(format!("CSV 文件包含 Unicode BOM，不能按 {label} 解码"));
        }
        _ => {}
    }
    match selection.encoding {
        TextEncoding::Utf8 => {
            let had_bom = bytes.starts_with(UTF8_BOM);
            let body = if had_bom {
                &bytes[UTF8_BOM.len()..]
            } else {
                bytes
            };
            let text = std::str::from_utf8(body)
                .map_err(|_| format!("无法按 {label} 解码 CSV 文件"))?
                .to_string();
            Ok(DecodedText {
                text,
                encoding: TextEncoding::Utf8,
                bom: if had_bom || selection.utf8_bom {
                    Some(UTF8_BOM.to_vec())
                } else {
                    None
                },
            })
        }
        TextEncoding::Utf16Le => {
            if bytes.starts_with(UTF16_BE_BOM) {
                return Err("CSV 文件包含 UTF-16BE BOM，不能按 UTF-16LE 解码".to_string());
            }
            let had_bom = bytes.starts_with(UTF16_LE_BOM);
            let body = if had_bom {
                &bytes[UTF16_LE_BOM.len()..]
            } else {
                bytes
            };
            Ok(DecodedText {
                text: decode_utf16(body, true)?,
                encoding: TextEncoding::Utf16Le,
                bom: had_bom.then(|| UTF16_LE_BOM.to_vec()),
            })
        }
        TextEncoding::Utf16Be => {
            if bytes.starts_with(UTF16_LE_BOM) {
                return Err("CSV 文件包含 UTF-16LE BOM，不能按 UTF-16BE 解码".to_string());
            }
            let had_bom = bytes.starts_with(UTF16_BE_BOM);
            let body = if had_bom {
                &bytes[UTF16_BE_BOM.len()..]
            } else {
                bytes
            };
            Ok(DecodedText {
                text: decode_utf16(body, false)?,
                encoding: TextEncoding::Utf16Be,
                bom: had_bom.then(|| UTF16_BE_BOM.to_vec()),
            })
        }
        TextEncoding::Gb18030 => {
            let (decoded, _, had_errors) = GB18030.decode(bytes);
            if had_errors {
                return Err(format!("无法按 {label} 解码 CSV 文件"));
            }
            Ok(DecodedText {
                text: decoded.into_owned(),
                encoding: TextEncoding::Gb18030,
                bom: None,
            })
        }
        TextEncoding::Gbk => {
            let (decoded, _, had_errors) = GBK.decode(bytes);
            if had_errors {
                return Err(format!("无法按 {label} 解码 CSV 文件"));
            }
            Ok(DecodedText {
                text: decoded.into_owned(),
                encoding: TextEncoding::Gbk,
                bom: None,
            })
        }
        TextEncoding::Big5 => {
            let (decoded, _, had_errors) = BIG5.decode(bytes);
            if had_errors {
                return Err(format!("无法按 {label} 解码 CSV 文件"));
            }
            Ok(DecodedText {
                text: decoded.into_owned(),
                encoding: TextEncoding::Big5,
                bom: None,
            })
        }
    }
}

fn decode_bytes(bytes: &[u8], requested: Option<EncodingSelection>) -> Result<DecodedText, String> {
    if let Some(selection) = requested {
        return decode_selected(bytes, selection);
    }

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

    if let Ok(text) = std::str::from_utf8(bytes) {
        return Ok(DecodedText {
            text: text.to_string(),
            encoding: TextEncoding::Utf8,
            bom: None,
        });
    }

    let (text, _, had_errors) = GB18030.decode(bytes);
    if had_errors {
        return Err("文件不是有效的 UTF-8，且无法按 GB18030 解码".to_string());
    }
    Ok(DecodedText {
        text: text.into_owned(),
        encoding: TextEncoding::Gb18030,
        bom: None,
    })
}

fn decode_text(path: &Path) -> Result<DecodedText, String> {
    let bytes = fs::read(path).map_err(|e| format!("读取文件失败: {e}"))?;
    decode_bytes(&bytes, None)
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
        TextEncoding::Gbk => {
            let (body, _, had_errors) = GBK.encode(text);
            if had_errors {
                return Err("内容包含无法用 GBK 编码保存的字符".to_string());
            }
            output.extend_from_slice(&body);
        }
        TextEncoding::Big5 => {
            let (body, _, had_errors) = BIG5.encode(text);
            if had_errors {
                return Err("内容包含无法用 BIG5 编码保存的字符".to_string());
            }
            output.extend_from_slice(&body);
        }
    }
    Ok(output)
}

fn encode_csv_text(
    text: &str,
    selection: EncodingSelection,
    preserved_bom: Option<&Option<Vec<u8>>>,
) -> Result<Vec<u8>, String> {
    let bom = if let Some(bom) = preserved_bom {
        bom.clone()
    } else {
        match selection.encoding {
            TextEncoding::Utf8 if selection.utf8_bom => Some(UTF8_BOM.to_vec()),
            TextEncoding::Utf16Le => Some(UTF16_LE_BOM.to_vec()),
            TextEncoding::Utf16Be => Some(UTF16_BE_BOM.to_vec()),
            _ => None,
        }
    };
    encode_text(text, selection.encoding, &bom)
}

fn dominant_line_ending(original: &str) -> &'static str {
    let crlf = original.matches("\r\n").count();
    let lf = original.matches('\n').count().saturating_sub(crlf);
    let cr = original.matches('\r').count().saturating_sub(crlf);
    if cr > crlf && cr > lf {
        "\r"
    } else if crlf > lf {
        "\r\n"
    } else {
        "\n"
    }
}

fn normalize_line_endings(content: &str, original: &str) -> String {
    let normalized = content.replace("\r\n", "\n").replace('\r', "\n");
    match dominant_line_ending(original) {
        "\r\n" => normalized.replace('\n', "\r\n"),
        "\r" => normalized.replace('\n', "\r"),
        _ => normalized,
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

fn hash_bytes(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn file_hash(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| format!("读取文件校验信息失败: {e}"))?;
    Ok(hash_bytes(&bytes))
}

fn build_csv_document(path: &Path, decoded: DecodedText, content_hash: String) -> CsvDocument {
    let encoding = decoded.encoding_label().to_string();
    CsvDocument {
        path: path.to_string_lossy().into_owned(),
        file_name: path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default(),
        file_size: fs::metadata(path)
            .map(|metadata| metadata.len())
            .unwrap_or(0),
        encoding,
        kind: "csv".to_string(),
        source: decoded.text,
        content_hash,
    }
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

fn is_csv_path(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case("csv"))
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
        || is_csv_path(path)
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

pub fn load_csv_file(path: &Path, encoding: Option<&str>) -> Result<CsvDocument, String> {
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("文件不存在或无法访问: {e}"))?;
    if !is_csv_path(&canonical) {
        return Err("仅支持 .csv 文件".to_string());
    }
    let selection = encoding
        .map(|value| {
            EncodingSelection::parse(value).ok_or_else(|| format!("不支持的 CSV 编码: {value}"))
        })
        .transpose()?;
    let bytes = fs::read(&canonical).map_err(|e| format!("读取文件失败: {e}"))?;
    let decoded = decode_bytes(&bytes, selection)?;
    let content_hash = hash_bytes(&bytes);
    Ok(build_csv_document(&canonical, decoded, content_hash))
}

#[cfg(test)]
pub fn save_csv_file(
    path: &Path,
    new_source: &str,
    encoding: &str,
    expected_hash: &str,
) -> Result<CsvDocument, String> {
    save_csv_file_with_origin(path, new_source, encoding, expected_hash, None)
}

pub fn save_csv_file_with_origin(
    path: &Path,
    new_source: &str,
    encoding: &str,
    expected_hash: &str,
    original_encoding: Option<&str>,
) -> Result<CsvDocument, String> {
    let selection = EncodingSelection::parse(encoding)
        .ok_or_else(|| format!("不支持的 CSV 编码: {encoding}"))?;
    let original_selection = original_encoding
        .map(|value| {
            EncodingSelection::parse(value).ok_or_else(|| format!("不支持的 CSV 原编码: {value}"))
        })
        .transpose()?;
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("文件不存在或无法访问: {e}"))?;
    if !is_csv_path(&canonical) {
        return Err("仅支持 .csv 文件".to_string());
    }
    let original_bytes = fs::read(&canonical).map_err(|e| format!("读取文件失败: {e}"))?;
    let current_hash = hash_bytes(&original_bytes);
    if current_hash != expected_hash {
        return Err("CSV 文件已被其他程序修改，已阻止覆盖，请刷新后重试".to_string());
    }
    let original = match original_selection {
        Some(origin) => decode_bytes(&original_bytes, Some(origin))
            .or_else(|_| decode_bytes(&original_bytes, None))?,
        None => decode_bytes(&original_bytes, None)?,
    };
    let normalized = normalize_line_endings(new_source, &original.text);
    let preserved_bom =
        (original.encoding_label() == selection.display_label()).then_some(&original.bom);
    let bytes = encode_csv_text(&normalized, selection, preserved_bom)?;
    if file_hash(&canonical)? != current_hash {
        return Err("CSV 文件在保存过程中被其他程序修改，已阻止覆盖，请刷新后重试".to_string());
    }
    atomic_write(&canonical, &bytes)?;
    let refreshed = decode_bytes(&bytes, Some(selection))?;
    let content_hash = hash_bytes(&bytes);
    Ok(build_csv_document(&canonical, refreshed, content_hash))
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
        "csv" => ("", ["csv"].as_slice()),
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
    fn creates_new_document_files_without_overwriting() {
        let dir = tempfile::tempdir().unwrap();
        let markdown = dir.path().join("new.md");
        let xml = dir.path().join("new.xml");
        let csv = dir.path().join("new.csv");
        create_document_file(&markdown, "markdown").unwrap();
        create_document_file(&xml, "xml").unwrap();
        create_document_file(&csv, "csv").unwrap();
        assert!(
            fs::read_to_string(&markdown)
                .unwrap()
                .starts_with("# 未命名文档")
        );
        assert!(fs::read_to_string(&xml).unwrap().contains("<root>"));
        assert_eq!(fs::read_to_string(&csv).unwrap(), "");
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
        fs::write(nested.join("data.csv"), "name,value\nA,1\n").unwrap();
        fs::write(nested.join("ignored.txt"), "ignored").unwrap();

        let files = scan_document_files(dir.path()).unwrap();
        assert_eq!(files.len(), 4);
        assert!(files.iter().any(|path| path.ends_with("root.XML")));
        assert!(files.iter().any(|path| path.ends_with("readme.md")));
        assert!(files.iter().any(|path| path.ends_with("guide.markdown")));
        assert!(files.iter().any(|path| path.ends_with("data.csv")));
        assert!(!files.iter().any(|path| path.ends_with("ignored.txt")));
    }

    #[test]
    fn command_line_accepts_supported_documents_only() {
        let dir = tempfile::tempdir().unwrap();
        let xml = dir.path().join("schema.xml");
        let md = dir.path().join("readme.md");
        let markdown = dir.path().join("guide.markdown");
        let csv = dir.path().join("data.csv");
        let ignored = dir.path().join("notes.txt");
        for path in [&xml, &md, &markdown, &csv, &ignored] {
            fs::write(path, "content").unwrap();
        }

        let args = vec![
            "viewer.exe".to_string(),
            xml.to_string_lossy().into_owned(),
            md.to_string_lossy().into_owned(),
            markdown.to_string_lossy().into_owned(),
            csv.to_string_lossy().into_owned(),
            ignored.to_string_lossy().into_owned(),
        ];
        let paths = document_paths_from_args(&args, None);
        assert_eq!(paths.len(), 4);
        assert!(paths.iter().any(|path| path.ends_with("data.csv")));
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
    fn csv_utf8_bom_round_trip_preserves_encoding_bom_and_crlf() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("data.csv");
        let mut bytes = UTF8_BOM.to_vec();
        bytes.extend_from_slice("name,value\r\nA,1\r\n".as_bytes());
        fs::write(&path, bytes).unwrap();

        let document = load_csv_file(&path, None).unwrap();
        assert_eq!(document.kind, "csv");
        assert_eq!(document.encoding, "UTF-8 BOM");
        assert_eq!(document.source, "name,value\r\nA,1\r\n");
        assert_eq!(document.content_hash.len(), 64);

        let saved = save_csv_file(
            &path,
            "name,value\nB,2\n",
            "UTF-8 BOM",
            &document.content_hash,
        )
        .unwrap();
        assert_eq!(saved.encoding, "UTF-8 BOM");
        assert_eq!(saved.source, "name,value\r\nB,2\r\n");
        assert!(fs::read(&path).unwrap().starts_with(UTF8_BOM));
    }

    #[test]
    fn csv_utf16_round_trip_preserves_endianness() {
        let dir = tempfile::tempdir().unwrap();
        for (name, little_endian, expected_encoding) in [
            ("little.csv", true, "UTF-16LE"),
            ("big.csv", false, "UTF-16BE"),
        ] {
            let path = dir.path().join(name);
            fs::write(&path, utf16_bytes("名称,值\n中文,1\n", little_endian)).unwrap();
            let document = load_csv_file(&path, None).unwrap();
            assert_eq!(document.encoding, expected_encoding);
            assert_eq!(document.source, "名称,值\n中文,1\n");

            let saved = save_csv_file(
                &path,
                "名称,值\n更新,2\n",
                expected_encoding,
                &document.content_hash,
            )
            .unwrap();
            assert_eq!(saved.encoding, expected_encoding);
            let bytes = fs::read(&path).unwrap();
            let expected_bom = if little_endian {
                UTF16_LE_BOM
            } else {
                UTF16_BE_BOM
            };
            assert!(bytes.starts_with(expected_bom));
            assert_eq!(
                decode_utf16(&bytes[expected_bom.len()..], little_endian).unwrap(),
                "名称,值\n更新,2\n"
            );
        }
    }

    fn legacy_csv_bytes(text: &str, encoding: &str) -> Vec<u8> {
        let (bytes, _, had_errors) = match encoding {
            "GB18030" => GB18030.encode(text),
            "GBK" => GBK.encode(text),
            "BIG5" => BIG5.encode(text),
            _ => panic!("unexpected test encoding"),
        };
        assert!(!had_errors);
        bytes.into_owned()
    }

    #[test]
    fn csv_explicit_encoding_rejects_mismatched_bom() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("bom.csv");
        let mut bytes = UTF8_BOM.to_vec();
        bytes.extend_from_slice("名称,值\n中文,1\n".as_bytes());
        fs::write(&path, bytes).unwrap();

        let error = load_csv_file(&path, Some("GBK")).unwrap_err();
        assert!(error.contains("BOM"));
    }

    #[test]
    fn csv_no_bom_utf16_preserves_bom_state_and_crlf() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("utf16-no-bom.csv");
        let bytes = "名称,值\r\n中文,1\r\n"
            .encode_utf16()
            .flat_map(|unit| unit.to_le_bytes())
            .collect::<Vec<_>>();
        fs::write(&path, bytes).unwrap();

        let document = load_csv_file(&path, Some("UTF-16LE")).unwrap();
        assert_eq!(document.encoding, "UTF-16LE");
        assert_eq!(document.source, "名称,值\r\n中文,1\r\n");
        let saved = save_csv_file_with_origin(
            &path,
            "名称,值\n更新,2\n",
            "UTF-16LE",
            &document.content_hash,
            Some("UTF-16LE"),
        )
        .unwrap();
        assert_eq!(saved.source, "名称,值\r\n更新,2\r\n");
        let bytes = fs::read(&path).unwrap();
        assert!(!bytes.starts_with(UTF16_LE_BOM));
        assert_eq!(decode_utf16(&bytes, true).unwrap(), "名称,值\r\n更新,2\r\n");
    }

    #[test]
    fn csv_explicit_gb18030_gbk_and_big5_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        for (name, encoding, source, edited) in [
            (
                "gb18030.csv",
                "GB18030",
                "名称,值\n中文,1\n",
                "名称,值\n更新,2\n",
            ),
            (
                "gbk.csv",
                "GBK",
                "名称,值\n简体,1\n",
                "名称,值\n简体更新,2\n",
            ),
            (
                "big5.csv",
                "BIG5",
                "名稱,值\n繁體,1\n",
                "名稱,值\n繁體更新,2\n",
            ),
        ] {
            let path = dir.path().join(name);
            fs::write(&path, legacy_csv_bytes(source, encoding)).unwrap();
            let document = load_csv_file(&path, Some(encoding)).unwrap();
            assert_eq!(document.encoding, encoding);
            assert_eq!(document.source, source);

            let saved = save_csv_file(&path, edited, encoding, &document.content_hash).unwrap();
            assert_eq!(saved.encoding, encoding);
            assert_eq!(saved.source, edited);
            let bytes = fs::read(&path).unwrap();
            let (decoded, _, had_errors) = match encoding {
                "GB18030" => GB18030.decode(&bytes),
                "GBK" => GBK.decode(&bytes),
                "BIG5" => BIG5.decode(&bytes),
                _ => unreachable!(),
            };
            assert!(!had_errors);
            assert_eq!(decoded, edited);
        }
    }

    #[test]
    fn csv_save_can_switch_encoding() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("switch.csv");
        fs::write(&path, "名称,值\r\n简体,1\r\n").unwrap();
        let document = load_csv_file(&path, None).unwrap();
        assert_eq!(document.encoding, "UTF-8");

        let saved =
            save_csv_file(&path, "名称,值\n简体,2\n", "GBK", &document.content_hash).unwrap();
        assert_eq!(saved.encoding, "GBK");
        assert_eq!(saved.source, "名称,值\r\n简体,2\r\n");
        let bytes = fs::read(&path).unwrap();
        let (decoded, _, had_errors) = GBK.decode(&bytes);
        assert!(!had_errors);
        assert_eq!(decoded, "名称,值\r\n简体,2\r\n");

        let reloaded = load_csv_file(&path, Some("GBK")).unwrap();
        assert_eq!(reloaded.encoding, "GBK");
        assert_eq!(reloaded.source, "名称,值\r\n简体,2\r\n");
    }

    #[test]
    fn csv_auto_detection_keeps_gb18030_fallback() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("auto.csv");
        fs::write(&path, legacy_csv_bytes("名称,值\n中文,1\n", "GB18030")).unwrap();
        let document = load_csv_file(&path, None).unwrap();
        assert_eq!(document.encoding, "GB18030");
        assert_eq!(document.source, "名称,值\n中文,1\n");
    }

    #[test]
    fn csv_save_rejects_external_modification() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("conflict.csv");
        fs::write(&path, "name,value\nA,1\n").unwrap();
        let document = load_csv_file(&path, None).unwrap();
        fs::write(&path, "name,value\nExternal,2\n").unwrap();

        let error = save_csv_file(
            &path,
            "name,value\nMine,3\n",
            "UTF-8",
            &document.content_hash,
        )
        .unwrap_err();
        assert!(error.contains("其他程序修改"));
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            "name,value\nExternal,2\n"
        );
    }

    #[test]
    fn text_save_preserves_dominant_line_ending_including_cr() {
        assert_eq!(
            normalize_line_endings("a\nb\nc\n", "a\r\nb\r\nc\r\n"),
            "a\r\nb\r\nc\r\n"
        );
        assert_eq!(
            normalize_line_endings("a\r\nb\r\nc\r\n", "a\nb\nc\n"),
            "a\nb\nc\n"
        );
        assert_eq!(
            normalize_line_endings("a\nb\nc\n", "a\rb\rc\r"),
            "a\rb\rc\r"
        );
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
