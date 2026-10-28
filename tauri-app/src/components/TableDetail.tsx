import { ArrowLeft, Braces, Database, KeyRound, Link2, ListTree, PencilLine, Table2 } from "lucide-react";
import type { TableInfo } from "../types";
import { tableSubtitle } from "../lib/xml";

interface TableDetailProps {
  table: TableInfo;
  onBack: () => void;
  onEdit: () => void;
}

function BoolBadge({ value, tone }: { value: boolean; tone: "key" | "required" }) {
  if (!value) return <span className="muted">-</span>;
  return <span className={`bool-badge ${tone}`}>{tone === "key" ? "PK" : "必填"}</span>;
}

export function TableDetail({ table, onBack, onEdit }: TableDetailProps) {
  const standardAttrs = new Set(["id", "name", "type", "volume", "frequency", "period", "tsp", "pkg", "view", "sql"]);
  const extraAttrs = Object.entries(table.attrs).filter(([key, value]) => !standardAttrs.has(key) && value);
  const meta = [
    ["模块", table.moduleName || table.moduleId],
    ["细目", table.submoduleId ? (table.submoduleName || table.submoduleId) : "直属表"],
    ["类型", table.tableType || "表"],
    ["容量", table.volume],
    ["频率", table.frequency],
    ["表空间", table.tsp],
    ["周期", table.period],
    ["包名", table.package],
    ["索引表空间", table.attrs.idxtsp || ""],
    ["JSP 路径", table.attrs.jspPath || ""],
    ["压缩", table.attrs.compress || ""],
    ["分区", table.attrs.partition || ""],
    ["不记日志", table.attrs.notlog || ""],
  ].filter(([, value]) => Boolean(value));

  return (
    <div className="page detail-page" data-testid="table-detail">
      <header className="detail-heading">
        <div className="detail-title-wrap">
          <button type="button" className="icon-button back-button" onClick={onBack} title="返回表目录">
            <ArrowLeft size={18} />
          </button>
          <div>
            <div className="eyebrow">
              <Database size={15} />
              {tableSubtitle(table)}
            </div>
            <h1>
              {table.id}
              {table.name && <span>{table.name}</span>}
            </h1>
          </div>
        </div>
        <button type="button" className="primary-button" onClick={onEdit}>
          <PencilLine size={16} />
          编辑此表
        </button>
      </header>

      <div className="meta-grid">
        {meta.map(([label, value]) => (
          <div className="meta-item" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
        <div className="meta-item">
          <span>字段数</span>
          <strong>{table.columns.length}</strong>
        </div>
      </div>

      {extraAttrs.length > 0 && (
        <div className="info-panel extra-attrs-panel">
          <div className="info-panel-title"><KeyRound size={16} />扩展属性</div>
          <div className="attr-grid">
            {extraAttrs.map(([key, value]) => (
              <div className="attr-item" key={key}><span>{key}</span><code>{value}</code></div>
            ))}
          </div>
        </div>
      )}

      {(table.view || table.sql) && (
        <div className="info-panel sql-panel">
          <div className="info-panel-title"><Braces size={16} />视图 SQL</div>
          <pre>{table.sql || table.view}</pre>
        </div>
      )}

      {table.remarks.length > 0 && (
        <div className="info-panel remarks-panel">
          <div className="info-panel-title"><ListTree size={16} />表备注</div>
          <div className="remarks-content">{table.remarks.join("\n")}</div>
        </div>
      )}

      <section className="field-section">
        <div className="section-title">
          <div>
            <Table2 size={17} />
            <h2>字段清单</h2>
          </div>
          <span>{table.columns.length} 个字段</span>
        </div>
        <div className="table-scroll">
          <table className="data-table field-table" data-testid="field-table">
            <colgroup>
              <col style={{ width: "52px" }} />
              <col style={{ width: "13%" }} />
              <col style={{ width: "13%" }} />
              <col style={{ width: "7%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "7%" }} />
              <col style={{ width: "9%" }} />
              <col style={{ width: "7%" }} />
              <col style={{ width: "auto" }} />
            </colgroup>
            <thead>
              <tr>
                <th>序号</th>
                <th>ID</th>
                <th>Name</th>
                <th>主键</th>
                <th>类型</th>
                <th>枚举值</th>
                <th>必填</th>
                <th>默认值</th>
                <th>格式</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {table.columns.map((column, index) => (
                <tr key={`${column.id}:${index}`}>
                  <td className="number-cell">{String(index + 1).padStart(2, "0")}</td>
                  <td className="mono-cell">{column.id || "-"}</td>
                  <td>{column.name || "-"}</td>
                  <td><BoolBadge value={column.primaryKey} tone="key" /></td>
                  <td className="mono-cell">
                    {column.columnType || "-"}
                    {column.size && <span className="size-text">({column.size})</span>}
                  </td>
                  <td>{column.enumValue || "-"}</td>
                  <td><BoolBadge value={column.required} tone="required" /></td>
                  <td className="mono-cell">{column.default || "-"}</td>
                  <td>{column.format || "-"}</td>
                  <td className="note-cell">
                {column.note || "-"}
                {Object.entries(column.attrs)
                  .filter(([key, value]) => !["id", "name", "type", "size", "required", "primaryKey", "default", "enumValue", "note", "format", "inputsize", "inputSize"].includes(key) && value)
                  .map(([key, value]) => (
                    <span className="column-extra" key={key}>{key}={value}</span>
                  ))}
              </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {(table.foreignKeys.length > 0 || table.indexes.length > 0) && (
        <div className="relation-grid">
          {table.foreignKeys.length > 0 && (
            <div className="info-panel">
              <div className="info-panel-title"><Link2 size={16} />外键关系</div>
              {table.foreignKeys.map((foreignKey, index) => (
                <div className="relation-row" key={`${foreignKey.foreignTable}:${index}`}>
                  <span>{foreignKey.foreignTable}</span>
                  {foreignKey.references.map((reference) => (
                    <code key={`${reference.local}:${reference.foreign}`}>
                      {reference.local} → {reference.foreign}
                    </code>
                  ))}
                </div>
              ))}
            </div>
          )}
          {table.indexes.length > 0 && (
            <div className="info-panel">
              <div className="info-panel-title"><KeyRound size={16} />索引</div>
              {table.indexes.map((index) => (
                <div className="relation-row" key={index.id}>
                  <span>{index.id}</span>
                  <code>{index.indexType || "INDEX"}</code>
                  <code>{index.columns.join(", ")}</code>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}




