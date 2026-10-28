import { Database, Layers3, Table2 } from "lucide-react";
import type { ModuleInfo, SubmoduleInfo, TableInfo, XmlDocument } from "../types";
import { formatBytes } from "../lib/xml";

interface OverviewProps {
  document: XmlDocument;
  modules: ModuleInfo[];
  search: string;
  onSelectTable: (table: TableInfo) => void;
}

function CatalogTable({
  tables,
  businessDetail,
  onSelectTable,
}: {
  tables: TableInfo[];
  businessDetail?: string;
  onSelectTable: (table: TableInfo) => void;
}) {
  return (
    <div className="table-scroll">
      <table className="data-table catalog-table" data-testid="module-catalog">
        <colgroup>
          <col style={{ width: "180px" }} />
          <col style={{ width: "17%" }} />
          <col style={{ width: "18%" }} />
          <col style={{ width: "13%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "7%" }} />
          <col style={{ width: "10%" }} />
          <col style={{ width: "10%" }} />
        </colgroup>
        <thead>
          <tr>
            <th>业务细目</th>
            <th>业务英文标识名</th>
            <th>业务中文名称</th>
            <th>生产表模式名</th>
            <th>类型</th>
            <th>字段数</th>
            <th>存储容量</th>
            <th>数据更新频率</th>
          </tr>
        </thead>
        <tbody>
          {tables.map((table) => (
            <tr key={table.nodeIndex}>
              <td>{businessDetail || table.submoduleName || table.moduleName || "-"}</td>
              <td>
                <button type="button" className="table-link" onClick={() => onSelectTable(table)}>
                  {table.id}
                </button>
              </td>
              <td>{table.name || "-"}</td>
              <td>{table.moduleId || "-"}</td>
              <td>{table.tableType || "表"}</td>
              <td className="number-cell">{table.columns.length}</td>
              <td>{table.volume || "-"}</td>
              <td>{table.frequency || "不更新"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SubmoduleCatalog({
  submodule,
  onSelectTable,
}: {
  submodule: SubmoduleInfo;
  onSelectTable: (table: TableInfo) => void;
}) {
  if (submodule.tables.length === 0) return null;
  return (
    <div className="catalog-subsection">
      <div className="catalog-subtitle">
        <span>{submodule.name || submodule.id}</span>
        <span>{submodule.tables.length} 张表</span>
      </div>
      <CatalogTable tables={submodule.tables} businessDetail={submodule.name || submodule.id} onSelectTable={onSelectTable} />
    </div>
  );
}

export function Overview({ document, modules, search, onSelectTable }: OverviewProps) {
  const allTables = modules.flatMap((module) => [
    ...module.tables,
    ...module.submodules.flatMap((submodule) => submodule.tables),
  ]);

  return (
    <div className="page overview-page" data-testid="overview-page">
      <header className="page-heading">
        <div>
          <div className="eyebrow">
            <Database size={15} />
            {document.database?.name || document.database?.id || "数据库"}
          </div>
          <h1>{search ? "筛选结果" : "表目录"}</h1>
          <p>{document.fileName} · {formatBytes(document.fileSize)} · {document.encoding}</p>
        </div>
        <div className="heading-badge">
          <Table2 size={16} />
          {allTables.length} 张表
        </div>
      </header>

      {modules.map((module) => {
        const direct = module.tables;
        const subTables = module.submodules.reduce((sum, submodule) => sum + submodule.tables.length, 0);
        if (direct.length === 0 && subTables === 0) return null;
        return (
          <section className="module-section" key={module.nodeIndex}>
            <div className="module-heading">
              <div>
                <Layers3 size={17} />
                <h2>{module.name || module.id}</h2>
                <span className="module-id">{module.id}</span>
                {module.subsystemId && <span className="module-id">子系统 {module.subsystemName || module.subsystemId}</span>}
              </div>
              <span>{direct.length + subTables} 张表</span>
            </div>
            {direct.length > 0 && (
              <div className="catalog-subsection">
                <div className="catalog-subtitle">
                  <span>直属表</span>
                  <span>{direct.length} 张表</span>
                </div>
                <CatalogTable tables={direct} businessDetail={module.name || module.id} onSelectTable={onSelectTable} />
              </div>
            )}
            {module.submodules.map((submodule) => (
              <SubmoduleCatalog key={submodule.nodeIndex} submodule={submodule} onSelectTable={onSelectTable} />
            ))}
          </section>
        );
      })}

      {allTables.length === 0 && (
        <div className="empty-search">
          <h2>没有匹配结果</h2>
          <p>可以搜索表名、表 ID、字段名、字段备注或枚举值。</p>
        </div>
      )}

      {allTables.length > 0 && (
        <section className="module-section all-tables-section">
          <div className="module-heading">
            <div>
              <Table2 size={17} />
              <h2>全部表目录</h2>
            </div>
            <span>{allTables.length} 张表</span>
          </div>
          <div className="table-scroll">
            <table className="data-table all-table" data-testid="all-table-catalog">
              <colgroup>
                <col style={{ width: "56px" }} />
                <col style={{ width: "13%" }} />
                <col style={{ width: "14%" }} />
                <col style={{ width: "14%" }} />
                <col style={{ width: "15%" }} />
                <col style={{ width: "11%" }} />
                <col style={{ width: "7%" }} />
                <col style={{ width: "7%" }} />
                <col style={{ width: "8%" }} />
                <col style={{ width: "9%" }} />
              </colgroup>
              <thead>
                <tr>
                  <th>序号</th>
                  <th>模块大类</th>
                  <th>业务细目</th>
                  <th>业务英文标识名</th>
                  <th>业务中文名称</th>
                  <th>生产表模式名</th>
                  <th>类型</th>
                  <th>字段数</th>
                  <th>存储容量</th>
                  <th>数据更新频率</th>
                </tr>
              </thead>
              <tbody>
                {allTables.map((table, index) => (
                  <tr key={table.nodeIndex}>
                    <td className="number-cell">{index + 1}</td>
                    <td>{table.moduleName || table.moduleId}</td>
                    <td>{table.submoduleId ? (table.submoduleName || table.submoduleId) : "直属表"}</td>
                    <td>
                      <button type="button" className="table-link" onClick={() => onSelectTable(table)}>
                        {table.id}
                      </button>
                    </td>
                    <td>{table.name || "-"}</td>
                    <td>{table.moduleId || "-"}</td>
                    <td>{table.tableType || "表"}</td>
                    <td className="number-cell">{table.columns.length}</td>
                    <td>{table.volume || "-"}</td>
                    <td>{table.frequency || "不更新"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}


