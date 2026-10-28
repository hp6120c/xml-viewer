import type { ModuleInfo, TableInfo, XmlDocument } from "../types";

export function allTables(document: XmlDocument | undefined): TableInfo[] {
  if (!document) return [];
  const tables: TableInfo[] = [];
  for (const module of document.modules) {
    tables.push(...module.tables);
    for (const submodule of module.submodules) {
      tables.push(...submodule.tables);
    }
  }
  return tables;
}

export function tableCount(document: XmlDocument | undefined): number {
  return allTables(document).length;
}

export function columnCount(document: XmlDocument | undefined): number {
  return allTables(document).reduce((sum, table) => sum + table.columns.length, 0);
}

export function moduleCount(document: XmlDocument | undefined): number {
  return document?.modules.length ?? 0;
}

export function filterModules(modules: ModuleInfo[], query: string): ModuleInfo[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return modules;

  return modules.flatMap((module) => {
    const moduleMatches = `${module.id} ${module.name}`.toLocaleLowerCase().includes(needle);
    const directTables = moduleMatches
      ? module.tables
      : module.tables.filter((table) => tableMatches(table, needle));
    const submodules = module.submodules.flatMap((submodule) => {
      const submoduleMatches = `${submodule.id} ${submodule.name}`
        .toLocaleLowerCase()
        .includes(needle);
      const tables = moduleMatches || submoduleMatches
        ? submodule.tables
        : submodule.tables.filter((table) => tableMatches(table, needle));
      return tables.length > 0 ? [{ ...submodule, tables }] : [];
    });

    if (moduleMatches || directTables.length > 0 || submodules.length > 0) {
      return [{ ...module, tables: directTables, submodules }];
    }
    return [];
  });
}

export function tableMatches(table: TableInfo, rawNeedle: string): boolean {
  const needle = rawNeedle.toLocaleLowerCase();
  const tableText = [
    table.id,
    table.name,
    table.moduleId,
    table.moduleName,
    table.submoduleId,
    table.submoduleName,
    table.remarks.join(" "),
  ]
    .join(" ")
    .toLocaleLowerCase();
  if (tableText.includes(needle)) return true;
  return table.columns.some((column) =>
    [column.id, column.name, column.note, column.enumValue, column.default]
      .join(" ")
      .toLocaleLowerCase()
      .includes(needle),
  );
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function tableSubtitle(table: TableInfo): string {
  if (table.submoduleId) {
    return table.submoduleName || table.submoduleId;
  }
  return table.moduleName || table.moduleId;
}

