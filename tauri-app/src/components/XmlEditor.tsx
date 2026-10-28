import { useEffect, useRef } from "react";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, foldGutter, indentOnInput, syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
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
import { xml } from "@codemirror/lang-xml";

interface XmlEditorProps {
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
    lineHeight: "1.55",
    overflow: "auto",
  },
  ".cm-content": {
    padding: "14px 0 80px",
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

export function XmlEditor({ value, onChange }: XmlEditorProps) {
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
        xml(),
        EditorView.lineWrapping,
        editorTheme,
        keymap.of([
          indentWithTab,
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
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
    if (current !== value) {
      valueRef.current = value;
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }
  }, [value]);

  return <div ref={containerRef} className="xml-editor" data-testid="xml-editor" />;
}


