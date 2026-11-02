import { useEffect, useRef } from "react";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import "./markdown-source-editor.css";

interface MarkdownSourceEditorProps {
  value: string;
  onChange: (value: string) => void;
}

const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "14px",
    backgroundColor: "#ffffff",
    color: "#24313f",
  },
  ".cm-scroller": {
    fontFamily: '"Cascadia Code", "JetBrains Mono", Consolas, monospace',
    lineHeight: "1.6",
    overflow: "auto",
  },
  ".cm-content": {
    padding: "16px 0 80px",
  },
  ".cm-gutters": {
    backgroundColor: "#f4f7fa",
    color: "#8795a5",
    borderRight: "1px solid #dce4ec",
  },
  ".cm-activeLine": {
    backgroundColor: "#f1f7ff",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "#e7f0fa",
  },
  "&.cm-focused": {
    outline: "none",
  },
});

export function MarkdownSourceEditor({ value, onChange }: MarkdownSourceEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const valueRef = useRef(value);
  onChangeRef.current = onChange;
  valueRef.current = value;

  useEffect(() => {
    if (!containerRef.current) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        foldGutter(),
        drawSelection(),
        dropCursor(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        markdown(),
        search({ top: true }),
        EditorView.lineWrapping,
        editorTheme,
        EditorView.contentAttributes.of({
          "aria-label": "Markdown 源码编辑器",
          spellcheck: "true",
        }),
        keymap.of([
          indentWithTab,
          ...closeBracketsKeymap,
          ...searchKeymap,
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          const userChanged = update.transactions.some((transaction) =>
            transaction.isUserEvent("input")
            || transaction.isUserEvent("delete")
            || transaction.isUserEvent("undo")
            || transaction.isUserEvent("redo"),
          );
          if (!userChanged) return;
          const next = update.state.doc.toString();
          if (next === valueRef.current) return;
          valueRef.current = next;
          onChangeRef.current(next);
        }),
      ],
    });
    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    valueRef.current = value;
    view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
  }, [value]);

  return (
    <div
      ref={containerRef}
      className="markdown-source-editor"
      data-testid="markdown-source-editor"
    />
  );
}
