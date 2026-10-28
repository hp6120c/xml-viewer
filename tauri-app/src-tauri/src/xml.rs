use encoding_rs::{Encoding, GB18030, GBK, UTF_8, UTF_16BE, UTF_16LE};
use roxmltree::{Document, Node, ParsingOptions};
use serde::Serialize;
use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use tempfile::NamedTempFile;
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseInfo {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnInfo {
    pub id: String,
    pub name: String,
    pub column_type: String,
    pub size: String,
    pub required: bool,
    pub primary_key: bool,
    #[serde(rename = "default")]
    pub default_value: String,
    pub enum_value: String,
    pub note: String,
    pub format: String,
    pub input_size: String,
    pub attrs: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForeignKeyInfo {
    pub foreign_table: String,
    pub references: Vec<ReferenceInfo>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceInfo {
    pub local: String,
    pub foreign: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexInfo {
    pub id: String,
    pub index_type: String,
    pub columns: Vec<String>,
    pub raw_columns: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableInfo {
    pub node_index: usize,
    pub id: String,
    pub name: String,
    pub module_id: String,
    pub module_name: String,
    pub submodule_id: String,
    pub submodule_name: String,
    pub table_type: String,
    pub view: String,
    pub sql: String,
    pub volume: String,
    pub frequency: String,
    pub period: String,
    pub tsp: String,
    pub package: String,
    pub columns: Vec<ColumnInfo>,
    pub remarks: Vec<String>,
    pub foreign_keys: Vec<ForeignKeyInfo>,
    pub indexes: Vec<IndexInfo>,
    pub attrs: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmoduleInfo {
    pub node_index: usize,
    pub id: String,
    pub name: String,
    pub tables: Vec<TableInfo>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleInfo {
    pub node_index: usize,
    pub id: String,
    pub name: String,
    pub subsystem_id: String,
    pub subsystem_name: String,
    pub submodules: Vec<SubmoduleInfo>,
    pub tables: Vec<TableInfo>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenericXmlNode {
    pub tag: String,
    pub attributes: BTreeMap<String, String>,
    pub text: String,
    pub children: Vec<GenericXmlNode>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct XmlDocument {
    pub path: String,
    pub file_name: String,
    pub file_size: u64,
    pub root_tag: String,
    pub encoding: String,
    pub kind: String,
    pub database: Option<DatabaseInfo>,
    pub modules: Vec<ModuleInfo>,
    pub generic_root: Option<GenericXmlNode>,
    pub raw_source: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableSource {
    pub table_index: usize,
    pub table_id: String,
    pub encoding: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSource {
    pub encoding: String,
    pub content: String,
}

struct DecodedXml {
    text: String,
    encoding: String,
    bom: Option<Vec<u8>>,
}

fn local_name<'a>(node: Node<'a, 'a>) -> &'a str {
    node.tag_name().name()
}

fn attrs(node: Node<'_, '_>) -> BTreeMap<String, String> {
    node.attributes()
        .map(|attr| (attr.name().to_string(), attr.value().to_string()))
        .collect()
}

fn attr(node: Node<'_, '_>, name: &str) -> String {
    node.attribute(name).unwrap_or_default().to_string()
}

fn attr_bool(node: Node<'_, '_>, name: &str) -> bool {
    matches!(
        attr(node, name).trim().to_ascii_lowercase().as_str(),
        "true" | "1" | "yes"
    )
}

fn detect_encoding(bytes: &[u8]) -> (String, Option<Vec<u8>>) {
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return ("UTF-8".to_string(), Some(vec![0xEF, 0xBB, 0xBF]));
    }
    if bytes.starts_with(&[0xFF, 0xFE]) {
        return ("UTF-16LE".to_string(), Some(vec![0xFF, 0xFE]));
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        return ("UTF-16BE".to_string(), Some(vec![0xFE, 0xFF]));
    }

    let head_len = bytes.len().min(512);
    let head = String::from_utf8_lossy(&bytes[..head_len]);
    let lower = head.to_ascii_lowercase();
    if let Some(start) = lower.find("encoding") {
        let rest = &head[start + "encoding".len()..];
        if let Some(eq_pos) = rest.find('=') {
            let after_eq = rest[eq_pos + 1..].trim_start();
            if let Some(quote) = after_eq.chars().next() {
                if quote == '"' || quote == '\'' {
                    if let Some(end) = after_eq[1..].find(quote) {
                        let label = after_eq[1..1 + end].trim();
                        if !label.is_empty() {
                            return (label.to_string(), None);
                        }
                    }
                }
            }
        }
    }
    ("UTF-8".to_string(), None)
}

fn encoding_for_label(label: &str) -> &'static Encoding {
    let normalized = label.trim().to_ascii_lowercase();
    match normalized.as_str() {
        "utf-16" | "utf-16le" => UTF_16LE,
        "utf-16be" => UTF_16BE,
        "gbk" | "gb2312" | "cp936" => GBK,
        "gb18030" => GB18030,
        "utf-8" | "utf8" => UTF_8,
        _ => Encoding::for_label(normalized.as_bytes()).unwrap_or(UTF_8),
    }
}

fn decode_xml(path: &Path) -> Result<DecodedXml, String> {
    let bytes = fs::read(path).map_err(|e| format!("读取文件失败: {e}"))?;
    let (encoding, bom) = detect_encoding(&bytes);
    let body = if let Some(ref prefix) = bom {
        &bytes[prefix.len()..]
    } else {
        &bytes[..]
    };
    let codec = encoding_for_label(&encoding);
    let (text, _, had_errors) = codec.decode(body);
    if had_errors {
        return Err(format!("文件编码 {encoding} 无法正确解码"));
    }
    Ok(DecodedXml {
        text: text.into_owned(),
        encoding,
        bom,
    })
}

fn encode_xml(text: &str, encoding: &str, bom: &Option<Vec<u8>>) -> Result<Vec<u8>, String> {
    let codec = encoding_for_label(encoding);
    let (body, _, had_errors) = codec.encode(text);
    if had_errors {
        return Err(format!("内容包含无法用 {encoding} 编码保存的字符"));
    }
    let mut output = Vec::with_capacity(body.len() + 3);
    if let Some(prefix) = bom {
        output.extend_from_slice(prefix);
    }
    output.extend_from_slice(&body);
    Ok(output)
}

fn parse_document(text: &str) -> Result<Document<'_>, String> {
    let options = ParsingOptions {
        allow_dtd: true,
        ..ParsingOptions::default()
    };
    Document::parse_with_options(text, options).map_err(|e| {
        format!(
            "XML 解析失败（第 {} 行，第 {} 列）: {}",
            e.pos().row,
            e.pos().col,
            e
        )
    })
}

fn find_database<'a>(root: Node<'a, 'a>) -> Option<Node<'a, 'a>> {
    root.descendants().find(|node| {
        node.is_element() && local_name(*node) == "database" && node.parent().is_some()
    })
}

fn collect_modules<'a>(db_node: Node<'a, 'a>) -> Vec<ModuleInfo> {
    let mut module_nodes: Vec<(Node<'a, 'a>, String, String)> = Vec::new();

    for child in db_node.children().filter(Node::is_element) {
        match local_name(child) {
            "module" => module_nodes.push((child, String::new(), String::new())),
            "subsystem" => {
                let subsystem_id = attr(child, "id");
                let subsystem_name = attr(child, "name");
                for module in child.children().filter(Node::is_element) {
                    if local_name(module) == "module" {
                        module_nodes.push((module, subsystem_id.clone(), subsystem_name.clone()));
                    }
                }
            }
            _ => {}
        }
    }

    let mut modules = Vec::new();
    let mut table_index = 0usize;

    for (module_index, (module_node, subsystem_id, subsystem_name)) in
        module_nodes.into_iter().enumerate()
    {
        let module_id = attr(module_node, "id");
        let module_name = attr(module_node, "name");
        let mut module = ModuleInfo {
            node_index: module_index,
            id: module_id.clone(),
            name: module_name.clone(),
            subsystem_id,
            subsystem_name,
            submodules: Vec::new(),
            tables: Vec::new(),
        };

        let mut submodule_index = 0usize;
        for child in module_node.children().filter(Node::is_element) {
            match local_name(child) {
                "table" => {
                    module.tables.push(parse_table(
                        child,
                        table_index,
                        &module_id,
                        &module_name,
                        "",
                        "",
                    ));
                    table_index += 1;
                }
                "submodule" => {
                    let sub_id = attr(child, "id");
                    let sub_name = attr(child, "name");
                    let mut submodule = SubmoduleInfo {
                        node_index: submodule_index,
                        id: sub_id.clone(),
                        name: sub_name.clone(),
                        tables: Vec::new(),
                    };
                    submodule_index += 1;
                    for table in child.children().filter(Node::is_element) {
                        if local_name(table) == "table" {
                            submodule.tables.push(parse_table(
                                table,
                                table_index,
                                &module_id,
                                &module_name,
                                &sub_id,
                                &sub_name,
                            ));
                            table_index += 1;
                        }
                    }
                    module.submodules.push(submodule);
                }
                _ => {}
            }
        }
        modules.push(module);
    }

    modules
}

fn parse_table(
    table_node: Node<'_, '_>,
    node_index: usize,
    module_id: &str,
    module_name: &str,
    submodule_id: &str,
    submodule_name: &str,
) -> TableInfo {
    let mut columns = Vec::new();
    let mut remarks = Vec::new();
    let mut foreign_keys = Vec::new();
    let mut indexes = Vec::new();

    for child in table_node.children().filter(Node::is_element) {
        match local_name(child) {
            "column" => {
                let all_attrs = attrs(child);
                let input_size = if child.attribute("inputSize").is_some() {
                    attr(child, "inputSize")
                } else {
                    attr(child, "inputsize")
                };
                columns.push(ColumnInfo {
                    id: attr(child, "id"),
                    name: attr(child, "name"),
                    column_type: attr(child, "type"),
                    size: attr(child, "size"),
                    required: attr_bool(child, "required"),
                    primary_key: attr_bool(child, "primaryKey"),
                    default_value: attr(child, "default"),
                    enum_value: attr(child, "enumValue"),
                    note: attr(child, "note"),
                    format: attr(child, "format"),
                    input_size,
                    attrs: all_attrs,
                });
            }
            "rem" => {
                let value = child.text().unwrap_or_default().trim();
                if !value.is_empty() && !value.chars().all(|ch| ch == '=') {
                    remarks.push(value.to_string());
                }
            }
            "foreign-key" => {
                let references = child
                    .children()
                    .filter(|node| node.is_element() && local_name(*node) == "reference")
                    .map(|reference| ReferenceInfo {
                        local: attr(reference, "local"),
                        foreign: attr(reference, "foreign"),
                    })
                    .collect();
                foreign_keys.push(ForeignKeyInfo {
                    foreign_table: attr(child, "foreignTable"),
                    references,
                });
            }
            "index" => {
                let raw_columns: Vec<String> = child
                    .children()
                    .filter(|node| node.is_element() && local_name(*node) == "index-column")
                    .map(|column| attr(column, "id"))
                    .collect();
                let columns = raw_columns
                    .iter()
                    .flat_map(|value| value.split(','))
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(ToString::to_string)
                    .collect();
                indexes.push(IndexInfo {
                    id: attr(child, "id"),
                    index_type: attr(child, "type"),
                    columns,
                    raw_columns,
                });
            }
            _ => {}
        }
    }

    TableInfo {
        node_index,
        id: attr(table_node, "id"),
        name: attr(table_node, "name"),
        module_id: module_id.to_string(),
        module_name: module_name.to_string(),
        submodule_id: submodule_id.to_string(),
        submodule_name: submodule_name.to_string(),
        table_type: attr(table_node, "type"),
        view: attr(table_node, "view"),
        sql: attr(table_node, "sql"),
        volume: attr(table_node, "volume"),
        frequency: attr(table_node, "frequency"),
        period: attr(table_node, "period"),
        tsp: attr(table_node, "tsp"),
        package: attr(table_node, "pkg"),
        columns,
        remarks,
        foreign_keys,
        indexes,
        attrs: attrs(table_node),
    }
}

fn build_generic_node(node: Node<'_, '_>) -> GenericXmlNode {
    let text = node
        .children()
        .filter(|child| child.is_text())
        .filter_map(|child| child.text())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    GenericXmlNode {
        tag: node.tag_name().name().to_string(),
        attributes: attrs(node),
        text,
        children: node
            .children()
            .filter(Node::is_element)
            .map(build_generic_node)
            .collect(),
    }
}
fn build_document(path: &Path, decoded: &DecodedXml) -> Result<XmlDocument, String> {
    let doc = parse_document(&decoded.text)?;
    let root = doc.root_element();
    let database_node = find_database(root);
    let database = database_node.map(|db| DatabaseInfo {
        id: attr(db, "id"),
        name: attr(db, "name"),
    });
    let is_scl = database_node.is_some();
    let modules = database_node.map(collect_modules).unwrap_or_default();
    let generic_root = if is_scl {
        None
    } else {
        Some(build_generic_node(root))
    };
    let raw_source = if is_scl {
        None
    } else {
        Some(decoded.text.clone())
    };
    let file_size = fs::metadata(path).map(|m| m.len()).unwrap_or(0);

    Ok(XmlDocument {
        path: path.to_string_lossy().into_owned(),
        file_name: path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default(),
        file_size,
        root_tag: local_name(root).to_string(),
        encoding: decoded.encoding.clone(),
        kind: if is_scl {
            "scl".to_string()
        } else {
            "xml".to_string()
        },
        database,
        modules,
        generic_root,
        raw_source,
    })
}

fn table_nodes<'a>(doc: &'a Document<'a>) -> Vec<Node<'a, 'a>> {
    doc.descendants()
        .filter(|node| node.is_element() && local_name(*node) == "table")
        .collect()
}

fn find_table_node<'a>(
    doc: &'a Document<'a>,
    table_index: usize,
    expected_id: &str,
) -> Result<Node<'a, 'a>, String> {
    let nodes = table_nodes(doc);
    let table = nodes
        .get(table_index)
        .copied()
        .ok_or_else(|| format!("文件内容已变化，未找到第 {} 张表", table_index + 1))?;
    let actual_id = attr(table, "id");
    if actual_id != expected_id {
        return Err(format!(
            "文件内容已变化：第 {} 张表期望 ID 为 {expected_id}，实际为 {actual_id}",
            table_index + 1
        ));
    }
    Ok(table)
}

pub fn load_xml_file(path: &Path) -> Result<XmlDocument, String> {
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("文件不存在或无法访问: {e}"))?;
    let decoded = decode_xml(&canonical)?;
    build_document(&canonical, &decoded)
}

pub fn get_table_source(
    path: &Path,
    table_index: usize,
    expected_id: &str,
) -> Result<TableSource, String> {
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("文件不存在或无法访问: {e}"))?;
    let decoded = decode_xml(&canonical)?;
    let doc = parse_document(&decoded.text)?;
    let table = find_table_node(&doc, table_index, expected_id)?;
    let range = table.range();
    Ok(TableSource {
        table_index,
        table_id: expected_id.to_string(),
        encoding: decoded.encoding,
        content: decoded.text[range].to_string(),
    })
}

pub fn get_file_source(path: &Path) -> Result<FileSource, String> {
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("文件不存在或无法访问: {e}"))?;
    let decoded = decode_xml(&canonical)?;
    parse_document(&decoded.text)?;
    Ok(FileSource {
        encoding: decoded.encoding,
        content: decoded.text,
    })
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

fn validate_table_fragment(fragment: &str, expected_id: &str) -> Result<(), String> {
    let wrapped = format!("<__xml_viewer_fragment>{fragment}</__xml_viewer_fragment>");
    let doc = Document::parse(&wrapped).map_err(|e| format!("编辑内容不是有效 XML: {e}"))?;
    let elements: Vec<_> = doc
        .root_element()
        .children()
        .filter(Node::is_element)
        .collect();
    if elements.len() != 1 || local_name(elements[0]) != "table" {
        return Err("编辑内容必须恰好包含一个 <table> 元素".to_string());
    }
    let table = elements[0];
    if attr(table, "id") != expected_id {
        return Err("表 ID 不允许在单表编辑器中修改".to_string());
    }

    let allowed = [
        "column",
        "rem",
        "foreign-key",
        "index",
        "unique",
        "uniontable",
    ];
    let mut column_ids = HashSet::new();
    let mut column_count = 0usize;
    for child in table.children().filter(Node::is_element) {
        let tag = local_name(child);
        if !allowed.contains(&tag) {
            return Err(format!(
                "表内包含不支持的子元素 <{tag}>，为避免破坏结构已阻止保存"
            ));
        }
        if tag == "column" {
            let id = attr(child, "id");
            if id.trim().is_empty() {
                return Err("字段 id 不能为空".to_string());
            }
            if !column_ids.insert(id.clone()) {
                return Err(format!("表内存在重复字段 ID：{id}"));
            }
            column_count += 1;
        }
    }
    if column_count == 0 {
        return Err("表至少需要保留一个 <column> 字段".to_string());
    }
    Ok(())
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

pub fn save_table_source(
    path: &Path,
    table_index: usize,
    expected_id: &str,
    new_source: &str,
) -> Result<XmlDocument, String> {
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("文件不存在或无法访问: {e}"))?;
    let decoded = decode_xml(&canonical)?;
    validate_table_fragment(new_source, expected_id)?;
    let doc = parse_document(&decoded.text)?;
    let table = find_table_node(&doc, table_index, expected_id)?;
    let range = table.range();
    let normalized = normalize_line_endings(new_source.trim(), &decoded.text);
    let merged = format!(
        "{}{}{}",
        &decoded.text[..range.start],
        normalized,
        &decoded.text[range.end..]
    );
    let merged_doc =
        parse_document(&merged).map_err(|e| format!("保存前校验失败，原文件未修改: {e}"))?;
    find_table_node(&merged_doc, table_index, expected_id)
        .map_err(|e| format!("保存前定位校验失败，原文件未修改: {e}"))?;
    let bytes = encode_xml(&merged, &decoded.encoding, &decoded.bom)?;
    atomic_write(&canonical, &bytes)?;
    let refreshed = decode_xml(&canonical)?;
    build_document(&canonical, &refreshed)
}

pub fn save_file_source(path: &Path, new_source: &str) -> Result<XmlDocument, String> {
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("文件不存在或无法访问: {e}"))?;
    let decoded = decode_xml(&canonical)?;
    parse_document(new_source).map_err(|e| format!("保存前校验失败，原文件未修改: {e}"))?;
    let normalized = normalize_line_endings(new_source, &decoded.text);
    let bytes = encode_xml(&normalized, &decoded.encoding, &decoded.bom)?;
    atomic_write(&canonical, &bytes)?;
    let refreshed = decode_xml(&canonical)?;
    build_document(&canonical, &refreshed)
}

pub fn scan_xml_files(folder: &Path) -> Result<Vec<String>, String> {
    let mut files = Vec::new();
    for entry in WalkDir::new(folder).follow_links(false).into_iter() {
        let Ok(entry) = entry else { continue };
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        let is_xml = path
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case("xml"));
        if is_xml {
            files.push(path.to_string_lossy().into_owned());
        }
    }
    files.sort_by_cached_key(|value| value.to_lowercase());
    Ok(files)
}

pub fn xml_paths_from_args(args: &[String]) -> Vec<String> {
    let mut paths = Vec::new();
    for arg in args.iter().skip(1) {
        if arg.starts_with('-') {
            continue;
        }
        let path = PathBuf::from(arg);
        if path.is_file()
            && path
                .extension()
                .and_then(|value| value.to_str())
                .is_some_and(|value| value.eq_ignore_ascii_case("xml"))
        {
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

    const SAMPLE: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE app-data SYSTEM "../scl_Schema.dtd">
<app-data>
  <database id="DB" name="数据库">
    <subsystem id="SYS">
      <module id="M" name="模块">
        <table id="DIRECT" name="直接表">
          <column id="C1" name="主键" type="VARCHAR" required="true" primaryKey="true" />
        </table>
        <submodule id="SUB" name="子模块">
          <table id="T" name="表">
            <rem>备注</rem>
            <column id="C2" name="字段" type="NUMBER" size="10" />
          </table>
        </submodule>
      </module>
    </subsystem>
  </database>
</app-data>"#;

    #[test]
    fn parses_direct_and_submodule_tables() {
        let decoded = DecodedXml {
            text: SAMPLE.to_string(),
            encoding: "UTF-8".into(),
            bom: None,
        };
        let doc = build_document(Path::new("sample.xml"), &decoded).unwrap();
        assert_eq!(doc.modules.len(), 1);
        assert_eq!(doc.modules[0].tables.len(), 1);
        assert_eq!(doc.modules[0].submodules[0].tables.len(), 1);
        let direct = &doc.modules[0].tables[0];
        assert!(direct.columns[0].primary_key);
        assert!(direct.columns[0].required);
    }

    #[test]
    #[ignore = "requires XML_VIEWER_TEST_DIR with real SCL files"]
    fn real_world_directory_roundtrip() {
        let dir = std::env::var("XML_VIEWER_TEST_DIR").expect("XML_VIEWER_TEST_DIR is required");
        let files = scan_xml_files(Path::new(&dir)).unwrap();
        assert_eq!(files.len(), 21);
        let mut table_total = 0usize;
        let mut column_total = 0usize;
        let mut direct_tables = 0usize;
        for path in &files {
            let document = load_xml_file(Path::new(path)).unwrap();
            for module in &document.modules {
                direct_tables += module.tables.len();
                table_total += module.tables.len();
                column_total += module
                    .tables
                    .iter()
                    .map(|table| table.columns.len())
                    .sum::<usize>();
                for submodule in &module.submodules {
                    table_total += submodule.tables.len();
                    column_total += submodule
                        .tables
                        .iter()
                        .map(|table| table.columns.len())
                        .sum::<usize>();
                }
            }
        }
        assert_eq!(table_total, 1173);
        assert_eq!(column_total, 15847);
        assert_eq!(direct_tables, 1);

        let temp_dir = tempfile::tempdir().unwrap();
        for (index, source_path) in files.iter().enumerate() {
            let copy_path = temp_dir.path().join(format!("roundtrip-{index}.xml"));
            fs::copy(source_path, &copy_path).unwrap();
            let before = fs::read(&copy_path).unwrap();
            let document = load_xml_file(&copy_path).unwrap();
            let table = document
                .modules
                .iter()
                .find_map(|module| module.tables.first())
                .or_else(|| {
                    document.modules.iter().find_map(|module| {
                        module.submodules.iter().find_map(|sub| sub.tables.first())
                    })
                })
                .expect("sample should contain a table")
                .clone();
            let source = get_table_source(&copy_path, table.node_index, &table.id).unwrap();
            save_table_source(&copy_path, table.node_index, &table.id, &source.content).unwrap();
            let after_valid_save = fs::read(&copy_path).unwrap();
            assert_eq!(
                before, after_valid_save,
                "no-op save must preserve bytes for {source_path}"
            );

            if index == 0 {
                let invalid = save_table_source(
                    &copy_path,
                    table.node_index,
                    &table.id,
                    "<table id=\"broken\"><broken>",
                );
                assert!(invalid.is_err());
                let after_invalid_save = fs::read(&copy_path).unwrap();
                assert_eq!(
                    before, after_invalid_save,
                    "failed validation must not modify the file"
                );
            }
        }
    }
    #[test]
    fn duplicate_table_ids_use_node_index() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("duplicate.xml");
        let xml = r#"<app-data><database id="D"><subsystem id="S"><module id="M"><submodule id="SUB"><table id="DUP" name="First"><column id="C1" /></table><table id="DUP" name="Second"><column id="C2" /></table></submodule></module></subsystem></database></app-data>"#;
        fs::write(&path, xml).unwrap();
        let document = load_xml_file(&path).unwrap();
        let tables = &document.modules[0].submodules[0].tables;
        assert_eq!(tables[0].node_index, 0);
        assert_eq!(tables[1].node_index, 1);
        let source = get_table_source(&path, 1, "DUP").unwrap();
        assert!(source.content.contains("name=\"Second\""));
        let changed = "<table id=\"DUP\" name=\"Changed\"><column id=\"C2\" /></table>";
        save_table_source(&path, 1, "DUP", changed).unwrap();
        let updated = fs::read_to_string(&path).unwrap();
        assert!(updated.contains("name=\"First\""));
        assert!(updated.contains("name=\"Changed\""));
    }

    #[test]
    fn non_scl_xml_gets_generic_tree() {
        let decoded = DecodedXml {
            text: "<root><child value=\"1\">text</child></root>".to_string(),
            encoding: "UTF-8".into(),
            bom: None,
        };
        let document = build_document(Path::new("generic.xml"), &decoded).unwrap();
        assert_eq!(document.kind, "xml");
        assert!(document.generic_root.is_some());
        assert!(document.raw_source.is_some());
    }
    #[test]
    fn rejects_invalid_table_fragment() {
        assert!(validate_table_fragment("<table><broken></table>", "A").is_err());
        assert!(
            validate_table_fragment("<table id=\"A\"><column id=\"C\" /></table>", "A").is_ok()
        );
        assert!(
            validate_table_fragment("<table id=\"B\"><column id=\"C\" /></table>", "A").is_err()
        );
    }
}
