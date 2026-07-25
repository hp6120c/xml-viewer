import xml.etree.ElementTree as ET
import os
from typing import Dict, List, Any, Optional


class XMLParser:
    """SCL Schema XML文件解析器"""

    @staticmethod
    def parse_file(file_path: str) -> Optional[Dict[str, Any]]:
        """解析SCL Schema XML文件，返回结构化数据。

        Returns
        -------
        dict | None
            {'file_info': {...}, 'databases': [...]} 或解析失败时返回 None。
        """
        try:
            tree = ET.parse(file_path)
            root = tree.getroot()
        except ET.ParseError as e:
            print(f"XML解析错误 {file_path}: {e}")
            return None
        except Exception as e:
            print(f"读取文件错误 {file_path}: {e}")
            return None

        file_info = {
            'file_path': file_path,
            'file_name': os.path.basename(file_path),
            'file_size': os.path.getsize(file_path),
            'root_tag': root.tag,
        }

        databases: List[Dict[str, Any]] = []
        for db_elem in root.findall('database'):
            databases.append(XMLParser._parse_database(db_elem))

        return {
            'file_info': file_info,
            'databases': databases,
        }

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _parse_database(db_elem: ET.Element) -> Dict[str, Any]:
        database_id = db_elem.get('id', '')
        database_name = db_elem.get('name', '')
        database: Dict[str, Any] = {
            'id': database_id,
            'name': database_name,
            'modules': [],
        }

        # <module> may appear directly under <database>
        for module_elem in db_elem.findall('module'):
            database['modules'].append(
                XMLParser._parse_module(module_elem, database_id, database_name)
            )

        # <module> may also appear inside <subsystem>
        for subsystem_elem in db_elem.findall('subsystem'):
            for module_elem in subsystem_elem.findall('module'):
                database['modules'].append(
                    XMLParser._parse_module(module_elem, database_id, database_name)
                )

        return database

    @staticmethod
    def _parse_module(
        module_elem: ET.Element,
        database_id: str,
        database_name: str,
    ) -> Dict[str, Any]:
        module_id = module_elem.get('id', '')
        module_name = module_elem.get('name', '')
        module: Dict[str, Any] = {
            'id': module_id,
            'name': module_name,
            'database_id': database_id,
            'database_name': database_name,
            'submodules': [],
            'tables': [],
        }

        for sub_elem in module_elem.findall('submodule'):
            module['submodules'].append(
                XMLParser._parse_submodule(
                    sub_elem, database_id, database_name, module_id, module_name
                )
            )

        # Tables directly under <module> (no <submodule> wrapper)
        for table_elem in module_elem.findall('table'):
            module['tables'].append(
                XMLParser._parse_table(
                    table_elem,
                    database_id, database_name,
                    module_id, module_name,
                    '', '',
                )
            )

        return module

    @staticmethod
    def _parse_submodule(
        sub_elem: ET.Element,
        database_id: str,
        database_name: str,
        module_id: str,
        module_name: str,
    ) -> Dict[str, Any]:
        sub_id = sub_elem.get('id', '')
        sub_name = sub_elem.get('name', '')
        submodule: Dict[str, Any] = {
            'id': sub_id,
            'name': sub_name,
            'database_id': database_id,
            'database_name': database_name,
            'module_id': module_id,
            'module_name': module_name,
            'tables': [],
        }

        for table_elem in sub_elem.findall('table'):
            submodule['tables'].append(
                XMLParser._parse_table(
                    table_elem,
                    database_id, database_name,
                    module_id, module_name,
                    sub_id, sub_name,
                )
            )

        return submodule

    @staticmethod
    def _parse_table(
        table_elem: ET.Element,
        database_id: str,
        database_name: str,
        module_id: str,
        module_name: str,
        submodule_id: str,
        submodule_name: str,
    ) -> Dict[str, Any]:
        remarks: List[str] = []
        for rem in table_elem.findall('rem'):
            text = (rem.text or '').strip()
            if text:
                remarks.append(text)

        columns: List[Dict[str, Any]] = []
        for col_elem in table_elem.findall('column'):
            columns.append(XMLParser._parse_column(col_elem))

        return {
            'id': table_elem.get('id', ''),
            'name': table_elem.get('name', ''),
            'type': table_elem.get('type', ''),
            'view': table_elem.get('view', ''),
            'sql': table_elem.get('sql', ''),
            'volume': table_elem.get('volume', ''),
            'frequency': table_elem.get('frequency', ''),
            'columns': columns,
            'remarks': remarks,
            'database_id': database_id,
            'database_name': database_name,
            'module_id': module_id,
            'module_name': module_name,
            'submodule_id': submodule_id,
            'submodule_name': submodule_name,
        }

    @staticmethod
    def _parse_column(col_elem: ET.Element) -> Dict[str, Any]:
        required_raw = col_elem.get('required', 'false')
        primary_raw = col_elem.get('primaryKey', 'false')
        return {
            'id': col_elem.get('id', ''),
            'name': col_elem.get('name', ''),
            'type': col_elem.get('type', ''),
            'size': col_elem.get('size', ''),
            'required': required_raw.lower() in ('true', '1', 'yes'),
            'primaryKey': primary_raw.lower() in ('true', '1', 'yes'),
            'default': col_elem.get('default', ''),
            'enumValue': col_elem.get('enumValue', ''),
            'note': col_elem.get('note', ''),
            'format': col_elem.get('format', ''),
            'inputsize': col_elem.get('inputsize', ''),
        }

    # ------------------------------------------------------------------
    # Public utility methods
    # ------------------------------------------------------------------

    @staticmethod
    def get_folder_xml_files(folder_path: str) -> List[str]:
        """递归查找文件夹下所有 .xml 文件，排除 scl_Schema.dtd 和 scl_Schema.xsl。"""
        exclude_names = {'scl_Schema.dtd', 'scl_Schema.xsl'}
        xml_files: List[str] = []
        for root_dir, _dirs, files in os.walk(folder_path):
            for file in files:
                if file.lower().endswith('.xml') and file not in exclude_names:
                    xml_files.append(os.path.join(root_dir, file))
        return sorted(xml_files)

    @staticmethod
    def get_all_tables(data: Dict[str, Any]) -> List[Dict[str, Any]]:
        """从 parse_file 返回的数据中提取所有表的扁平列表。"""
        tables: List[Dict[str, Any]] = []
        for database in data.get('databases', []):
            for module in database.get('modules', []):
                # Tables directly under module
                for table in module.get('tables', []):
                    tables.append(table)
                # Tables under submodules
                for submodule in module.get('submodules', []):
                    for table in submodule.get('tables', []):
                        tables.append(table)
        return tables
