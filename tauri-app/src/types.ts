export interface DatabaseInfo {
  id: string;
  name: string;
}

export interface ColumnInfo {
  id: string;
  name: string;
  columnType: string;
  size: string;
  required: boolean;
  primaryKey: boolean;
  default: string;
  enumValue: string;
  note: string;
  format: string;
  inputSize: string;
  attrs: Record<string, string>;
}

export interface ReferenceInfo {
  local: string;
  foreign: string;
}

export interface ForeignKeyInfo {
  foreignTable: string;
  references: ReferenceInfo[];
}

export interface IndexInfo {
  id: string;
  indexType: string;
  columns: string[];
  rawColumns: string[];
}

export interface TableInfo {
  nodeIndex: number;
  id: string;
  name: string;
  moduleId: string;
  moduleName: string;
  submoduleId: string;
  submoduleName: string;
  tableType: string;
  view: string;
  sql: string;
  volume: string;
  frequency: string;
  period: string;
  tsp: string;
  package: string;
  columns: ColumnInfo[];
  remarks: string[];
  foreignKeys: ForeignKeyInfo[];
  indexes: IndexInfo[];
  attrs: Record<string, string>;
}

export interface SubmoduleInfo {
  nodeIndex: number;
  id: string;
  name: string;
  tables: TableInfo[];
}

export interface ModuleInfo {
  nodeIndex: number;
  id: string;
  name: string;
  subsystemId: string;
  subsystemName: string;
  submodules: SubmoduleInfo[];
  tables: TableInfo[];
}

export interface GenericXmlNode {
  tag: string;
  attributes: Record<string, string>;
  text: string;
  children: GenericXmlNode[];
}

export interface XmlDocument {
  path: string;
  fileName: string;
  fileSize: number;
  rootTag: string;
  encoding: string;
  kind: "scl" | "xml";
  database: DatabaseInfo | null;
  modules: ModuleInfo[];
  genericRoot: GenericXmlNode | null;
  rawSource: string | null;
}

export interface MarkdownDocument {
  path: string;
  fileName: string;
  fileSize: number;
  encoding: string;
  kind: "markdown";
  source: string;
  contentHash: string;
}

export type OpenedDocument = XmlDocument | MarkdownDocument;

export interface TableSource {
  tableIndex: number;
  tableId: string;
  encoding: string;
  content: string;
}

export interface AppInfo {
  version: string;
}

