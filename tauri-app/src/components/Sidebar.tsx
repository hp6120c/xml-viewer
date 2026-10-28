import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Folder, FolderOpen, SearchX, Table2 } from "lucide-react";
import type { ModuleInfo, SubmoduleInfo, TableInfo, XmlDocument } from "../types";
import { tableCount } from "../lib/xml";

interface SidebarProps {
  document: XmlDocument;
  modules: ModuleInfo[];
  search: string;
  selectedTableIndex: number | null;
  onSelectTable: (table: TableInfo) => void;
}

function TableButton({
  table,
  active,
  onSelect,
  submoduleName,
}: {
  table: TableInfo;
  active: boolean;
  onSelect: (table: TableInfo) => void;
  submoduleName?: string;
}) {
  return (
    <button
      type="button"
      className={`tree-table ${active ? "active" : ""}`}
      onClick={() => onSelect(table)}
      title={`${table.id}${table.name ? ` · ${table.name}` : ""}`}
    >
      <Table2 size={14} />
      <span className="tree-table-id">{table.id}</span>
      {table.name && <span className="tree-table-name">{table.name}</span>}
      {submoduleName && <span className="tree-table-sub">{submoduleName}</span>}
    </button>
  );
}

function SubmoduleBranch({
  submodule,
  selectedTableIndex,
  search,
  onSelectTable,
}: {
  submodule: SubmoduleInfo;
  selectedTableIndex: number | null;
  search: string;
  onSelectTable: (table: TableInfo) => void;
}) {
  const [open, setOpen] = useState(true);
  const expanded = Boolean(search) || open;
  return (
    <div className="tree-branch">
      <button
        type="button"
        className="tree-branch-title submodule"
        aria-expanded={expanded}
        onClick={() => {
          if (!search) setOpen(!open);
        }}
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <FolderOpen size={14} />
        <span>{submodule.name || submodule.id}</span>
        <span className="tree-count">{submodule.tables.length}</span>
      </button>
      {expanded && (
        <div className="tree-table-list">
          {submodule.tables.map((table) => (
            <TableButton
              key={`${submodule.id}:${table.id}`}
              table={table}
              active={selectedTableIndex === table.nodeIndex}
              onSelect={onSelectTable}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function Sidebar({ document, modules, search, selectedTableIndex, onSelectTable }: SidebarProps) {
  const [closedModules, setClosedModules] = useState<Set<string>>(new Set());
  const [closedDirect, setClosedDirect] = useState<Set<string>>(new Set());

  useEffect(() => {
    setClosedModules(new Set());
    setClosedDirect(new Set());
  }, [document.path]);

  const toggleModule = (id: string) => {
    setClosedModules((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleDirect = (id: string) => {
    setClosedDirect((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const total = modules.reduce(
    (sum, module) => sum + module.tables.length + module.submodules.reduce((n, sub) => n + sub.tables.length, 0),
    0,
  );

  return (
    <aside className="sidebar" data-testid="sidebar">
      <div className="sidebar-heading">
        <span>数据表导航</span>
        <span className="sidebar-total">{search ? `${total}/${tableCount(document)}` : total}</span>
      </div>
      <div className="tree-scroll">
        {modules.length === 0 && (
          <div className="tree-empty">
            <SearchX size={26} />
            <span>没有匹配的表或字段</span>
          </div>
        )}
        {modules.map((module) => {
          const collapsed = !search && closedModules.has(String(module.nodeIndex));
          const directCollapsed = !search && closedDirect.has(String(module.nodeIndex));
          return (
            <section className="tree-module" key={module.nodeIndex}>
              <button type="button" className="tree-branch-title module" aria-expanded={!collapsed} onClick={() => toggleModule(String(module.nodeIndex))}>
                {collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                <Folder size={15} />
                <span>{module.name || module.id}</span>
                <span className="tree-count">
                  {module.tables.length + module.submodules.reduce((n, sub) => n + sub.tables.length, 0)}
                </span>
              </button>
              {!collapsed && (
                <div className="module-content">
                  {module.tables.length > 0 && (
                    <div className="direct-table-group">
                      <button type="button" className="tree-direct-title" onClick={() => toggleDirect(module.id)}>
                        {directCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                        直属表
                      </button>
                      {!directCollapsed &&
                        module.tables.map((table) => (
                          <TableButton
                            key={table.nodeIndex}
                            table={table}
                            active={selectedTableIndex === table.nodeIndex}
                            onSelect={onSelectTable}
                          />
                        ))}
                    </div>
                  )}
                  {module.submodules.map((submodule) => (
                    <SubmoduleBranch
                      key={submodule.nodeIndex}
                      submodule={submodule}
                      selectedTableIndex={selectedTableIndex}
                      search={search}
                      onSelectTable={onSelectTable}
                    />
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </aside>
  );
}


