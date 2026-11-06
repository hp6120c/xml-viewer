import {
  forwardRef,
  useDeferredValue,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { ListFilter, Search, X } from "lucide-react";
import * as Papa from "papaparse";
import type { ParseError } from "papaparse";
import "./csv-editor.css";

export interface CsvEditorProps {
  source: string;
  encoding: string;
  fileName: string;
  readOnly: boolean;
  onSourceChange: (source: string) => void;
  onEncodingChange: (encoding: string) => void;
  onReloadEncoding: () => void;
  onDraftChange: () => void;
}

export interface CsvEditorHandle {
  flushPendingEdit: () => string | null;
}

type DelimiterChoice = "auto" | "," | "\t" | ";" | "|";
type SortDirection = "asc" | "desc" | null;
type ColumnFilter = Set<string> | null;

interface ParsedCsv {
  rows: string[][];
  delimiter: string;
  newline: string;
  hasBom: boolean;
  endsWithNewline: boolean;
  errors: ParseError[];
}

interface DataRow {
  cells: string[];
  sourceIndex: number;
}

interface EditingCell {
  rowIndex: number;
  columnIndex: number;
  value: string;
}

interface ColumnStats {
  total: number;
  nonEmpty: number;
  empty: number;
  unique: number;
  numericCount: number;
  min: number | null;
  max: number | null;
  sum: number | null;
  average: number | null;
}

interface FilterPopoverState {
  column: number;
  left: number;
  top: number;
  values: string[];
}

const DELIMITER_OPTIONS: Array<{ value: DelimiterChoice; label: string }> = [
  { value: "auto", label: "自动检测" },
  { value: ",", label: "逗号 (,)" },
  { value: "\t", label: "制表符 (Tab)" },
  { value: ";", label: "分号 (;)" },
  { value: "|", label: "竖线 (|)" },
];

const ENCODINGS = [
  "UTF-8",
  "UTF-8 BOM",
  "UTF-16LE",
  "UTF-16BE",
  "GB18030",
  "GBK",
  "BIG5",
] as const;

const VIRTUAL_ROW_HEIGHT = 34;
const VIRTUAL_OVERSCAN = 8;
const FILTER_ITEM_HEIGHT = 28;
const FILTER_LIST_HEIGHT = 220;
const FILTER_OVERSCAN = 5;
const FILTER_POPOVER_WIDTH = 302;
const FILTER_POPOVER_HEIGHT = 402;

function detectLineEnding(source: string): string {
  if (source.includes("\r\n")) return "\r\n";
  if (source.includes("\n")) return "\n";
  if (source.includes("\r")) return "\r";
  return "\r\n";
}

function parseCsvSource(source: string, delimiterChoice: DelimiterChoice): ParsedCsv {
  const hasBom = source.charCodeAt(0) === 0xfeff;
  const text = hasBom ? source.slice(1) : source;
  const result = Papa.parse<string[]>(text, {
    ...(delimiterChoice === "auto" ? {} : { delimiter: delimiterChoice }),
    quoteChar: "\"",
    escapeChar: "\"",
    header: false,
    skipEmptyLines: false,
    dynamicTyping: false,
  });

  const endsWithNewline = /(?:\r\n|\n|\r)$/.test(text);
  const rows = result.data.length > 0 ? [...result.data] : [[""]];
  if (endsWithNewline && rows.length > 0) {
    const lastRow = rows[rows.length - 1];
    if (lastRow.length === 1 && lastRow[0] === "") rows.pop();
  }

  return {
    rows: rows.length > 0 ? rows : [[""]],
    delimiter: result.meta.delimiter || ",",
    newline: detectLineEnding(text),
    hasBom,
    endsWithNewline,
    errors: result.errors,
  };
}

function serializeCsvRows(
  rows: string[][],
  delimiter: string,
  newline: string,
  hasBom: boolean,
  endsWithNewline: boolean,
): string {
  const serialized = Papa.unparse(rows.length > 0 ? rows : [[""]], {
    delimiter,
    newline,
    quoteChar: "\"",
    escapeChar: "\"",
  });
  const terminated = endsWithNewline ? `${serialized}${newline}` : serialized;
  return hasBom ? `\uFEFF${terminated}` : terminated;
}

function parseNumeric(value: string): number | null {
  const normalized = value.trim().replace(/,/g, "");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: 2,
  }).format(value);
}

function delimiterLabel(delimiter: string): string {
  if (delimiter === "\t") return "Tab";
  if (delimiter === ",") return "逗号";
  if (delimiter === ";") return "分号";
  if (delimiter === "|") return "竖线";
  return delimiter || "未知";
}

function compareCellValues(left: string, right: string): number {
  const leftTrimmed = left.trim();
  const rightTrimmed = right.trim();
  if (!leftTrimmed && !rightTrimmed) return 0;
  if (!leftTrimmed) return 1;
  if (!rightTrimmed) return -1;

  const leftNumber = parseNumeric(leftTrimmed);
  const rightNumber = parseNumeric(rightTrimmed);
  if (leftNumber !== null && rightNumber !== null) return leftNumber - rightNumber;
  return leftTrimmed.localeCompare(rightTrimmed, "zh-CN", {
    numeric: true,
    sensitivity: "base",
  });
}

function filterOptionLabel(value: string): string {
  return value === "" ? "(空白)" : value;
}

function measureTextWidth(value: string): number {
  let width = 0;
  for (const character of value) {
    width += character.charCodeAt(0) > 255 ? 13 : 7;
  }
  return width;
}

function collectUniqueValues(rows: DataRow[], column: number): string[] {
  const values = new Set<string>();
  for (const row of rows) values.add(row.cells[column] ?? "");
  return Array.from(values).sort((left, right) => {
    const leftEmpty = left === "";
    const rightEmpty = right === "";
    if (leftEmpty !== rightEmpty) return leftEmpty ? 1 : -1;
    return left.localeCompare(right, "zh-CN", { numeric: true, sensitivity: "base" });
  });
}
export const CsvEditor = forwardRef<CsvEditorHandle, CsvEditorProps>(function CsvEditor({
  source,
  encoding,
  fileName,
  readOnly,
  onSourceChange,
  onEncodingChange,
  onReloadEncoding,
  onDraftChange,
}, ref) {
  const [delimiterChoice, setDelimiterChoice] = useState<DelimiterChoice>("auto");
  const [hasHeader, setHasHeader] = useState(true);
  const [globalFilter, setGlobalFilter] = useState("");
  const deferredGlobalFilter = useDeferredValue(globalFilter);
  const [columnFilters, setColumnFilters] = useState<Record<number, ColumnFilter>>({});
  const [sortColumn, setSortColumn] = useState<number | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);
  const [selectedColumn, setSelectedColumn] = useState<number | null>(null);
  const [selectedRow, setSelectedRow] = useState<number | null>(null);
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [virtualScrollTop, setVirtualScrollTop] = useState(0);
  const [tableViewportHeight, setTableViewportHeight] = useState(480);
  const [filterPopover, setFilterPopover] = useState<FilterPopoverState | null>(null);
  const [filterSearch, setFilterSearch] = useState("");
  const [filterDraft, setFilterDraft] = useState<Set<string>>(new Set());
  const [filterListScrollTop, setFilterListScrollTop] = useState(0);
  const editInputRef = useRef<HTMLTextAreaElement | null>(null);
  const tableWrapRef = useRef<HTMLDivElement | null>(null);
  const filterListRef = useRef<HTMLDivElement | null>(null);
  const cancelBlurRef = useRef(false);
  const scrollFrameRef = useRef<number | null>(null);
  const editingCellRef = useRef<EditingCell | null>(null);
  editingCellRef.current = editingCell;

  const parsed = useMemo(
    () => parseCsvSource(source, delimiterChoice),
    [delimiterChoice, source],
  );

  const columnCount = useMemo(
    () => Math.max(1, parsed.rows.reduce((max, row) => Math.max(max, row.length), 0)),
    [parsed.rows],
  );

  const columnLabels = useMemo(
    () => Array.from({ length: columnCount }, (_, column) => {
      const header = hasHeader ? parsed.rows[0]?.[column]?.trim() : "";
      return header || `列 ${column + 1}`;
    }),
    [columnCount, hasHeader, parsed.rows],
  );

  const dataRows = useMemo<DataRow[]>(() => {
    const offset = hasHeader ? 1 : 0;
    return parsed.rows.slice(offset).map((cells, index) => ({
      cells,
      sourceIndex: index + offset,
    }));
  }, [hasHeader, parsed.rows]);

  const columnWidths = useMemo(() => {
    const offset = hasHeader ? 1 : 0;
    const sampleEnd = Math.min(parsed.rows.length, offset + 200);
    return Array.from({ length: columnCount }, (_, column) => {
      let width = measureTextWidth(columnLabels[column] ?? "") + 50;
      for (let rowIndex = offset; rowIndex < sampleEnd; rowIndex += 1) {
        const value = parsed.rows[rowIndex]?.[column] ?? "";
        width = Math.max(width, Math.min(360, measureTextWidth(value) + 28));
      }
      return Math.max(140, Math.min(360, width));
    });
  }, [columnCount, columnLabels, hasHeader, parsed.rows]);

  const tableWidth = useMemo(
    () => 54 + columnWidths.reduce((sum, width) => sum + width, 0),
    [columnWidths],
  );

  const activeFilterColumnCount = useMemo(
    () => Object.values(columnFilters).filter((filter) => filter !== null).length,
    [columnFilters],
  );

  const filteredRows = useMemo(() => {
    const globalNeedle = deferredGlobalFilter.trim().toLocaleLowerCase();
    const exactFilters = Object.entries(columnFilters)
      .filter((entry): entry is [string, Set<string>] => entry[1] !== null)
      .map(([column, values]) => [Number(column), values] as const);
    if (!globalNeedle && exactFilters.length === 0) return dataRows;

    return dataRows.filter((row) => {
      if (
        globalNeedle
        && !row.cells.some((cell) => cell.toLocaleLowerCase().includes(globalNeedle))
      ) {
        return false;
      }
      for (const [column, values] of exactFilters) {
        if (!values.has(row.cells[column] ?? "")) return false;
      }
      return true;
    });
  }, [columnFilters, dataRows, deferredGlobalFilter]);

  const sortedRows = useMemo(() => {
    if (sortColumn === null || sortDirection === null || sortColumn >= columnCount) {
      return filteredRows;
    }
    const direction = sortDirection === "asc" ? 1 : -1;
    return [...filteredRows].sort((left, right) => {
      const leftValue = left.cells[sortColumn] ?? "";
      const rightValue = right.cells[sortColumn] ?? "";
      const leftEmpty = leftValue.trim() === "";
      const rightEmpty = rightValue.trim() === "";
      if (leftEmpty !== rightEmpty) return leftEmpty ? 1 : -1;
      return direction * compareCellValues(leftValue, rightValue);
    });
  }, [columnCount, filteredRows, sortColumn, sortDirection]);

  const rowCount = sortedRows.length;
  const virtualStart = Math.max(
    0,
    Math.floor(virtualScrollTop / VIRTUAL_ROW_HEIGHT) - VIRTUAL_OVERSCAN,
  );
  const virtualVisibleCount = Math.ceil(tableViewportHeight / VIRTUAL_ROW_HEIGHT) + VIRTUAL_OVERSCAN * 2;
  const virtualEnd = Math.min(rowCount, virtualStart + virtualVisibleCount);
  const visibleRows = sortedRows.slice(virtualStart, virtualEnd);
  const topSpacerHeight = virtualStart * VIRTUAL_ROW_HEIGHT;
  const bottomSpacerHeight = Math.max(0, (rowCount - virtualEnd) * VIRTUAL_ROW_HEIGHT);

  const currentEncoding = encoding || "UTF-8";
  const encodingOptions = useMemo(
    () => Array.from(new Set([currentEncoding, ...ENCODINGS])),
    [currentEncoding],
  );

  const columnStats = useMemo<ColumnStats | null>(() => {
    if (selectedColumn === null || selectedColumn >= columnCount) return null;
    const values = sortedRows.map((row) => row.cells[selectedColumn] ?? "");
    const nonEmptyValues = values.filter((value) => value.trim() !== "");
    const numericValues = nonEmptyValues
      .map(parseNumeric)
      .filter((value): value is number => value !== null);
    const sum = numericValues.length > 0
      ? numericValues.reduce((total, value) => total + value, 0)
      : null;

    return {
      total: values.length,
      nonEmpty: nonEmptyValues.length,
      empty: values.length - nonEmptyValues.length,
      unique: new Set(nonEmptyValues).size,
      numericCount: numericValues.length,
      min: numericValues.length > 0
        ? numericValues.reduce((minimum, value) => Math.min(minimum, value), numericValues[0])
        : null,
      max: numericValues.length > 0
        ? numericValues.reduce((maximum, value) => Math.max(maximum, value), numericValues[0])
        : null,
      sum,
      average: sum !== null ? sum / numericValues.length : null,
    };
  }, [columnCount, selectedColumn, sortedRows]);

  const filteredFilterValues = useMemo(() => {
    if (!filterPopover) return [];
    const needle = filterSearch.trim().toLocaleLowerCase();
    if (!needle) return filterPopover.values;
    return filterPopover.values.filter((value) =>
      filterOptionLabel(value).toLocaleLowerCase().includes(needle),
    );
  }, [filterPopover, filterSearch]);

  const filterVirtualStart = Math.max(
    0,
    Math.floor(filterListScrollTop / FILTER_ITEM_HEIGHT) - FILTER_OVERSCAN,
  );
  const filterVirtualEnd = Math.min(
    filteredFilterValues.length,
    filterVirtualStart + Math.ceil(FILTER_LIST_HEIGHT / FILTER_ITEM_HEIGHT) + FILTER_OVERSCAN * 2,
  );
  const filterVisibleValues = filteredFilterValues.slice(filterVirtualStart, filterVirtualEnd);
  const filterAllSelected = Boolean(
    filterPopover
    && filterDraft.size === filterPopover.values.length
    && filterPopover.values.every((value) => filterDraft.has(value)),
  );
  useEffect(() => {
    setDelimiterChoice("auto");
    setHasHeader(true);
    setGlobalFilter("");
    setColumnFilters({});
    setSortColumn(null);
    setSortDirection(null);
    setSelectedColumn(null);
    setSelectedRow(null);
    setEditingCell(null);
    setFilterPopover(null);
    if (tableWrapRef.current) tableWrapRef.current.scrollTop = 0;
    setVirtualScrollTop(0);
  }, [fileName]);

  useEffect(() => {
    if (selectedColumn !== null && selectedColumn >= columnCount) {
      setSelectedColumn(null);
    }
  }, [columnCount, selectedColumn]);

  useEffect(() => {
    if (selectedRow !== null && !sortedRows.some((row) => row.sourceIndex === selectedRow)) {
      setSelectedRow(null);
    }
    if (editingCell && !sortedRows.some((row) => row.sourceIndex === editingCell.rowIndex)) {
      editingCellRef.current = null;
      setEditingCell(null);
    }
  }, [editingCell, selectedRow, sortedRows]);

  useEffect(() => {
    const element = tableWrapRef.current;
    if (!element) return;
    const updateViewport = () => setTableViewportHeight(element.clientHeight);
    updateViewport();
    const observer = new ResizeObserver(updateViewport);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!editingCell) return;
    const frame = window.requestAnimationFrame(() => {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editingCell?.columnIndex, editingCell?.rowIndex]);

  useEffect(() => {
    if (!filterPopover) return;
    const closeOnPointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest("[data-csv-filter-popover]") || target.closest("[data-csv-filter-trigger]")) {
        return;
      }
      setFilterPopover(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFilterPopover(null);
    };
    const closeOnResize = () => setFilterPopover(null);
    window.addEventListener("pointerdown", closeOnPointer);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", closeOnResize);
    return () => {
      window.removeEventListener("pointerdown", closeOnPointer);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", closeOnResize);
    };
  }, [filterPopover]);

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);
  }, []);

  const resetTableScroll = () => {
    if (tableWrapRef.current) tableWrapRef.current.scrollTop = 0;
    setVirtualScrollTop(0);
  };

  const serializeRows = (nextRows: string[][]) => serializeCsvRows(
    nextRows,
    parsed.delimiter,
    parsed.newline,
    parsed.hasBom,
    parsed.endsWithNewline,
  );

  const emitRows = (nextRows: string[][]) => {
    onSourceChange(serializeRows(nextRows));
    editingCellRef.current = null;
    setEditingCell(null);
  };

  const sourceForCell = (cell: EditingCell): string | null => {
    const currentValue = parsed.rows[cell.rowIndex]?.[cell.columnIndex] ?? "";
    if (currentValue === cell.value) return null;

    const nextRows = parsed.rows.slice();
    const nextCellRow = [...(nextRows[cell.rowIndex] ?? [])];
    while (nextCellRow.length <= cell.columnIndex) nextCellRow.push("");
    nextCellRow[cell.columnIndex] = cell.value;
    nextRows[cell.rowIndex] = nextCellRow;
    return serializeRows(nextRows);
  };

  const commitCell = (cell: EditingCell) => {
    if (readOnly) return;
    const nextSource = sourceForCell(cell);
    editingCellRef.current = null;
    setEditingCell(null);
    if (nextSource !== null) onSourceChange(nextSource);
  };

  useImperativeHandle(ref, () => ({
    flushPendingEdit: () => {
      const pending = editingCellRef.current;
      if (readOnly || !pending) return null;
      const nextSource = sourceForCell(pending);
      editingCellRef.current = null;
      setEditingCell(null);
      if (nextSource !== null) onSourceChange(nextSource);
      return nextSource;
    },
  }), [onSourceChange, parsed.rows, readOnly]);

  const cancelEditing = () => {
    cancelBlurRef.current = true;
    editingCellRef.current = null;
    setEditingCell(null);
  };

  const handleEditKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelEditing();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.blur();
    }
  };

  const handleEditBlur = () => {
    if (cancelBlurRef.current) {
      cancelBlurRef.current = false;
      return;
    }
    const pending = editingCellRef.current;
    if (pending) commitCell(pending);
  };

  const handleTableScroll = () => {
    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const pending = editingCellRef.current;
      if (pending) commitCell(pending);
      setVirtualScrollTop(tableWrapRef.current?.scrollTop ?? 0);
    });
  };

  const handleSort = (column: number) => {
    setSelectedColumn(column);
    setSelectedRow(null);
    if (sortColumn !== column) {
      setSortColumn(column);
      setSortDirection("asc");
    } else {
      setSortDirection((current) => current === "asc" ? "desc" : "asc");
    }
    resetTableScroll();
  };

  const addRow = () => {
    if (readOnly) return;
    const nextRows = parsed.rows.map((row) => [...row]);
    nextRows.push(Array.from({ length: columnCount }, () => ""));
    emitRows(nextRows);
    setGlobalFilter("");
    setColumnFilters({});
    setSortColumn(null);
    setSortDirection(null);
    setSelectedRow(nextRows.length - 1);
    window.setTimeout(() => {
      if (tableWrapRef.current) tableWrapRef.current.scrollTop = tableWrapRef.current.scrollHeight;
    }, 0);
  };

  const addColumn = () => {
    if (readOnly) return;
    const nextRows = parsed.rows.map((row) => {
      const nextRow = [...row];
      while (nextRow.length < columnCount) nextRow.push("");
      nextRow.push("");
      return nextRow;
    });
    emitRows(nextRows);
    setSelectedColumn(columnCount);
    resetTableScroll();
  };

  const deleteSelectedRow = () => {
    if (
      readOnly
      || selectedRow === null
      || selectedRow < 0
      || selectedRow >= parsed.rows.length
      || parsed.rows.length <= 1
    ) {
      return;
    }
    const nextRows = parsed.rows.filter((_, index) => index !== selectedRow);
    emitRows(nextRows);
    setSelectedRow(null);
    setColumnFilters({});
    resetTableScroll();
  };

  const deleteSelectedColumn = () => {
    if (
      readOnly
      || selectedColumn === null
      || selectedColumn < 0
      || selectedColumn >= columnCount
      || columnCount <= 1
    ) {
      return;
    }
    const nextRows = parsed.rows.map((row) => row.filter((_, index) => index !== selectedColumn));
    emitRows(nextRows);
    setSelectedColumn(Math.min(selectedColumn, columnCount - 2));
    setColumnFilters({});
    setSortColumn(null);
    setSortDirection(null);
    setFilterPopover(null);
    resetTableScroll();
  };

  const openFilter = (event: React.MouseEvent<HTMLButtonElement>, column: number) => {
    event.stopPropagation();
    setSelectedColumn(column);
    const values = collectUniqueValues(dataRows, column);
    const existing = columnFilters[column];
    setFilterDraft(new Set(existing ?? values));
    setFilterSearch("");
    setFilterListScrollTop(0);
    const rect = event.currentTarget.getBoundingClientRect();
    const left = Math.min(
      Math.max(8, rect.right - FILTER_POPOVER_WIDTH),
      Math.max(8, window.innerWidth - FILTER_POPOVER_WIDTH - 8),
    );
    const below = rect.bottom + 6;
    const top = below + FILTER_POPOVER_HEIGHT > window.innerHeight - 8
      ? Math.max(8, rect.top - FILTER_POPOVER_HEIGHT - 6)
      : below;
    setFilterPopover({ column, left, top, values });
    window.requestAnimationFrame(() => {
      if (filterListRef.current) filterListRef.current.scrollTop = 0;
    });
  };

  const toggleFilterValue = (value: string) => {
    setFilterDraft((current) => {
      const next = new Set(current);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  };

  const applyColumnFilter = () => {
    if (!filterPopover) return;
    const column = filterPopover.column;
    const allSelected = filterDraft.size === filterPopover.values.length
      && filterPopover.values.every((value) => filterDraft.has(value));
    setColumnFilters((current) => {
      const next = { ...current };
      if (allSelected) delete next[column];
      else next[column] = new Set(filterDraft);
      return next;
    });
    setFilterPopover(null);
    resetTableScroll();
  };

  const clearColumnFilter = () => {
    if (!filterPopover) return;
    setColumnFilters((current) => {
      const next = { ...current };
      delete next[filterPopover.column];
      return next;
    });
    setFilterPopover(null);
    resetTableScroll();
  };

  const clearFilters = () => {
    setGlobalFilter("");
    setColumnFilters({});
    setFilterPopover(null);
    resetTableScroll();
  };

  const clearSort = () => {
    setSortColumn(null);
    setSortDirection(null);
    resetTableScroll();
  };
  const selectedColumnLabel = selectedColumn === null
    ? ""
    : columnLabels[selectedColumn] ?? `列 ${selectedColumn + 1}`;
  const activeDelimiter = parsed.delimiter;
  const hasActiveFilter = Boolean(globalFilter.trim()) || activeFilterColumnCount > 0;
  const filterStatus = deferredGlobalFilter !== globalFilter ? "正在筛选…" : "";

  return (
    <section className={`csv-editor${readOnly ? " csv-editor-readonly" : ""}`} aria-label={`CSV 编辑器 ${fileName}`}>
      <header className="csv-editor-toolbar">
        <div className="csv-editor-title-group">
          <div className="csv-editor-title">CSV</div>
          <div className="csv-editor-file" title={fileName}>{fileName}</div>
          {readOnly && <span className="csv-editor-readonly-badge">只读</span>}
        </div>

        <div className="csv-editor-controls">
          <label className="csv-editor-control">
            <span>分隔符</span>
            <select
              value={delimiterChoice}
              onChange={(event) => {
                setDelimiterChoice(event.target.value as DelimiterChoice);
                resetTableScroll();
              }}
              aria-label="CSV 分隔符"
            >
              {DELIMITER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <span className="csv-editor-detected-delimiter">
            当前：{delimiterLabel(activeDelimiter)}
          </span>

          <button
            type="button"
            className={`csv-editor-button${hasHeader ? " active" : ""}`}
            aria-pressed={hasHeader}
            onClick={() => {
              setHasHeader((current) => !current);
              setSelectedRow(null);
              setEditingCell(null);
              resetTableScroll();
            }}
          >
            首行表头
          </button>

          <label className="csv-editor-control">
            <span>编码</span>
            <select
              value={currentEncoding}
              onChange={(event) => onEncodingChange(event.target.value)}
              aria-label="CSV 文件编码"
              title="选择保存编码；保存时会按该编码写回文件"
            >
              {encodingOptions.map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="csv-editor-button"
            onClick={onReloadEncoding}
            title="按当前选择的编码重新读取磁盘文件，用于修正自动识别错误"
          >
            按编码重读
          </button>

          <button
            type="button"
            className="csv-editor-button"
            onClick={addRow}
            disabled={readOnly}
          >
            新增行
          </button>
          <button
            type="button"
            className="csv-editor-button"
            onClick={addColumn}
            disabled={readOnly}
          >
            新增列
          </button>
          <button
            type="button"
            className="csv-editor-button danger"
            onClick={deleteSelectedRow}
            disabled={readOnly || selectedRow === null || parsed.rows.length <= 1}
          >
            删除行
          </button>
          <button
            type="button"
            className="csv-editor-button danger"
            onClick={deleteSelectedColumn}
            disabled={readOnly || selectedColumn === null || columnCount <= 1}
          >
            删除列
          </button>
        </div>
      </header>

      <div className="csv-editor-filter-bar">
        <label className="csv-editor-global-filter">
          <span>全局搜索</span>
          <input
            value={globalFilter}
            onChange={(event) => {
              setGlobalFilter(event.target.value);
              resetTableScroll();
            }}
            placeholder="搜索所有单元格..."
            aria-label="全局筛选 CSV"
          />
        </label>
        <button
          type="button"
          className="csv-editor-button subtle"
          onClick={clearFilters}
          disabled={!hasActiveFilter}
        >
          清除筛选
        </button>
        <button
          type="button"
          className="csv-editor-button subtle"
          onClick={clearSort}
          disabled={sortColumn === null}
        >
          清除排序
        </button>
        <span className="csv-editor-counter">
          {filterStatus && <span className="csv-editor-filtering-status">{filterStatus}</span>}
          {sortedRows.length.toLocaleString("zh-CN")} / {dataRows.length.toLocaleString("zh-CN")} 行
          · {columnCount} 列
          {activeFilterColumnCount > 0 ? ` · ${activeFilterColumnCount} 列已筛选` : ""}
        </span>
      </div>

      {parsed.errors.length > 0 && (
        <div className="csv-editor-errors" role="alert">
          <strong>CSV 解析提示</strong>
          <span>
            {parsed.errors.slice(0, 4).map((error, index) => (
              <span className="csv-editor-error" key={`${error.code}:${error.row ?? index}:${index}`}>
                {typeof error.row === "number" ? `第 ${error.row + 1} 行：` : ""}
                {error.message}
              </span>
            ))}
            {parsed.errors.length > 4 && <span>另有 {parsed.errors.length - 4} 条提示</span>}
          </span>
        </div>
      )}

      <div
        ref={tableWrapRef}
        className="csv-editor-table-wrap"
        onScroll={handleTableScroll}
        data-testid="csv-table-scroll"
      >
        <table
          className="csv-editor-table"
          style={{ width: `${tableWidth}px` }}
        >
          <caption className="csv-editor-sr-only">{fileName} 数据表</caption>
          <colgroup>
            <col style={{ width: 54 }} />
            {columnWidths.map((width, column) => (
              <col key={`column-width-${column}`} style={{ width }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className="csv-editor-row-heading" scope="col">#</th>
              {Array.from({ length: columnCount }, (_, column) => {
                const filterActive = columnFilters[column] !== null && columnFilters[column] !== undefined;
                return (
                  <th
                    className={`csv-editor-column-heading${selectedColumn === column ? " selected" : ""}`}
                    key={`heading-${column}`}
                    scope="col"
                  >
                    <div className="csv-editor-column-actions">
                      <button
                        type="button"
                        className="csv-editor-sort-button"
                        onClick={() => handleSort(column)}
                        title="选择此列并切换排序"
                      >
                        <span>{columnLabels[column]}</span>
                        <span className="csv-editor-sort-mark">
                          {sortColumn === column
                            ? sortDirection === "asc" ? "↑" : "↓"
                            : "↕"}
                        </span>
                      </button>
                      <button
                        type="button"
                        className={`csv-editor-filter-button${filterActive ? " active" : ""}`}
                        onClick={(event) => openFilter(event, column)}
                        aria-label={`筛选列 ${columnLabels[column]}`}
                        aria-pressed={filterActive}
                        title={`按${columnLabels[column]}筛选`}
                        data-csv-filter-trigger
                      >
                        <ListFilter size={13} />
                      </button>
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>            {rowCount === 0 ? (
              <tr>
                <td className="csv-editor-empty" colSpan={columnCount + 1}>没有匹配的数据</td>
              </tr>
            ) : (
              <>
                {topSpacerHeight > 0 && (
                  <tr className="csv-editor-spacer" aria-hidden="true">
                    <td colSpan={columnCount + 1} style={{ height: topSpacerHeight }} />
                  </tr>
                )}
                {visibleRows.map((row) => (
                  <tr
                    key={`row-${row.sourceIndex}`}
                    className={selectedRow === row.sourceIndex ? "selected-row" : ""}
                    style={{ height: VIRTUAL_ROW_HEIGHT }}
                  >
                    <th className="csv-editor-row-heading" scope="row">
                      <button
                        type="button"
                        className="csv-editor-row-number"
                        onClick={() => setSelectedRow(row.sourceIndex)}
                        aria-label={`选择第 ${hasHeader ? row.sourceIndex : row.sourceIndex + 1} 行`}
                      >
                        {hasHeader ? row.sourceIndex : row.sourceIndex + 1}
                      </button>
                    </th>
                    {Array.from({ length: columnCount }, (_, column) => {
                      const value = row.cells[column] ?? "";
                      const editing = editingCell?.rowIndex === row.sourceIndex
                        && editingCell.columnIndex === column;
                      return (
                        <td
                          key={`cell-${row.sourceIndex}-${column}`}
                          className={`${selectedColumn === column ? "selected-column" : ""}${value === "" ? " empty-cell" : ""}`}
                          onClick={() => {
                            setSelectedColumn(column);
                            setSelectedRow(row.sourceIndex);
                          }}
                          onDoubleClick={() => {
                            if (readOnly) return;
                            setSelectedColumn(column);
                            setSelectedRow(row.sourceIndex);
                            cancelBlurRef.current = false;
                            const nextCell = {
                              rowIndex: row.sourceIndex,
                              columnIndex: column,
                              value,
                            };
                            editingCellRef.current = nextCell;
                            setEditingCell(nextCell);
                          }}
                          title={readOnly ? value : "双击编辑单元格"}
                        >
                          {editing ? (
                            <textarea
                              ref={editInputRef}
                              className="csv-editor-cell-input"
                              value={editingCell.value}
                              onChange={(event) => {
                                const nextValue = event.target.value;
                                onDraftChange();
                                setEditingCell((current) => {
                                  if (!current) return current;
                                  const next = { ...current, value: nextValue };
                                  editingCellRef.current = next;
                                  return next;
                                });
                              }}
                              onBlur={handleEditBlur}
                              onKeyDown={handleEditKeyDown}
                              rows={1}
                              spellCheck={false}
                              aria-label={`编辑第 ${hasHeader ? row.sourceIndex : row.sourceIndex + 1} 行第 ${column + 1} 列`}
                            />
                          ) : (
                            <span className="csv-editor-cell-text">{value || "—"}</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {bottomSpacerHeight > 0 && (
                  <tr className="csv-editor-spacer" aria-hidden="true">
                    <td colSpan={columnCount + 1} style={{ height: bottomSpacerHeight }} />
                  </tr>
                )}
              </>
            )}
          </tbody>
        </table>
      </div>

      <footer className="csv-editor-footer">
        {columnStats && (
          <div className="csv-editor-stats">
            <strong>列统计 · {selectedColumnLabel}</strong>
            <span>非空 {columnStats.nonEmpty.toLocaleString("zh-CN")}</span>
            <span>空值 {columnStats.empty.toLocaleString("zh-CN")}</span>
            <span>唯一值 {columnStats.unique.toLocaleString("zh-CN")}</span>
            {columnStats.numericCount > 0 && (
              <>
                <span>数值 {columnStats.numericCount.toLocaleString("zh-CN")}</span>
                <span>最小 {formatNumber(columnStats.min ?? 0)}</span>
                <span>最大 {formatNumber(columnStats.max ?? 0)}</span>
                <span>合计 {formatNumber(columnStats.sum ?? 0)}</span>
                <span>平均 {formatNumber(columnStats.average ?? 0)}</span>
              </>
            )}
          </div>
        )}

        <div className="csv-editor-view-summary">
          <span>共 {dataRows.length.toLocaleString("zh-CN")} 行</span>
          {sortedRows.length !== dataRows.length && (
            <span>筛选后 {sortedRows.length.toLocaleString("zh-CN")} 行</span>
          )}
          <span>滚动浏览全部数据 · 不分页</span>
        </div>
      </footer>

      {filterPopover && createPortal(
        <div
          className="csv-editor-filter-popover"
          style={{ left: filterPopover.left, top: filterPopover.top }}
          data-csv-filter-popover
          data-testid="csv-filter-popover"
          role="dialog"
          aria-label={`筛选 ${columnLabels[filterPopover.column]}`}
        >
          <div className="csv-editor-filter-popover-header">
            <strong>筛选：{columnLabels[filterPopover.column]}</strong>
            <button type="button" onClick={() => setFilterPopover(null)} aria-label="关闭筛选">
              <X size={15} />
            </button>
          </div>
          <label className="csv-editor-filter-search">
            <Search size={14} />
            <input
              value={filterSearch}
              onChange={(event) => {
                setFilterSearch(event.target.value);
                setFilterListScrollTop(0);
                if (filterListRef.current) filterListRef.current.scrollTop = 0;
              }}
              placeholder="搜索筛选值..."
              aria-label="搜索筛选值"
              autoFocus
            />
          </label>
          <div className="csv-editor-filter-actions">
            <button type="button" onClick={() => setFilterDraft(new Set(filterPopover.values))}>全选</button>
            <button type="button" onClick={() => setFilterDraft(new Set())}>清空</button>
            <span>{filterDraft.size.toLocaleString("zh-CN")} / {filterPopover.values.length.toLocaleString("zh-CN")}</span>
          </div>
          <div
            ref={filterListRef}
            className="csv-editor-filter-options"
            onScroll={(event) => setFilterListScrollTop(event.currentTarget.scrollTop)}
            style={{ height: FILTER_LIST_HEIGHT }}
          >
            <div
              className="csv-editor-filter-options-content"
              style={{ height: filteredFilterValues.length * FILTER_ITEM_HEIGHT }}
            >
              {filterVisibleValues.map((value, index) => (
                <label
                  key={`${filterPopover.column}:${value}`}
                  className="csv-editor-filter-option"
                  style={{ top: (filterVirtualStart + index) * FILTER_ITEM_HEIGHT }}
                >
                  <input
                    type="checkbox"
                    checked={filterDraft.has(value)}
                    onChange={() => toggleFilterValue(value)}
                  />
                  <span title={filterOptionLabel(value)}>{filterOptionLabel(value)}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="csv-editor-filter-footer">
            <button
              type="button"
              className="csv-editor-button subtle"
              onClick={clearColumnFilter}
            >
              清除此列筛选
            </button>
            <div className="csv-editor-filter-footer-actions">
              <button type="button" className="csv-editor-button" onClick={() => setFilterPopover(null)}>取消</button>
              <button type="button" className="csv-editor-button primary" onClick={applyColumnFilter}>
                应用筛选
              </button>
            </div>
          </div>
          <span className="csv-editor-sr-only">
            {filterAllSelected ? "全部筛选值已选中" : "部分筛选值已选中"}
          </span>
        </div>,
        document.body,
      )}
    </section>
  );
});