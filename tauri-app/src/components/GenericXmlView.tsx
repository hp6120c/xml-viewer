import { useState } from "react";
import { Braces, ChevronDown, ChevronRight, FileCode2, Tags } from "lucide-react";
import type { GenericXmlNode, XmlDocument } from "../types";
import { formatBytes } from "../lib/xml";

function NodeView({ node, depth = 0 }: { node: GenericXmlNode; depth?: number }) {
  const [open, setOpen] = useState(depth < 2);
  const attributes = Object.entries(node.attributes);
  const hasChildren = node.children.length > 0;

  return (
    <div className="xml-node" style={{ "--depth": depth } as React.CSSProperties}>
      <button type="button" className="xml-node-row" onClick={() => hasChildren && setOpen(!open)}>
        <span className="xml-node-toggle">
          {hasChildren ? (open ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : <span />}
        </span>
        <Tags size={14} />
        <span className="xml-node-tag">&lt;{node.tag}&gt;</span>
        {attributes.map(([key, value]) => (
          <span className="xml-attr" key={key}>
            <span>{key}</span>="{value}"
          </span>
        ))}
        {node.text && <span className="xml-text">{node.text}</span>}
        {hasChildren && <span className="xml-child-count">{node.children.length}</span>}
      </button>
      {open && hasChildren && (
        <div className="xml-node-children">
          {node.children.map((child, index) => (
            <NodeView key={`${child.tag}:${index}`} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export function GenericXmlView({ document }: { document: XmlDocument }) {
  const [showSource, setShowSource] = useState(false);
  return (
    <div className="page generic-xml-page" data-testid="generic-xml-view">
      <header className="page-heading">
        <div>
          <div className="eyebrow"><FileCode2 size={15} />通用 XML 预览</div>
          <h1>{document.fileName}</h1>
          <p>{formatBytes(document.fileSize)} · {document.encoding} · 根节点 {document.rootTag}</p>
        </div>
        <button type="button" className="secondary-button" onClick={() => setShowSource(!showSource)}>
          <Braces size={16} />{showSource ? "节点视图" : "源码视图"}
        </button>
      </header>
      <div className="generic-notice">
        未检测到 SCL Schema 的 database 结构，已切换为通用 XML 查看模式。此模式不会按数据库表结构解释内容。
      </div>
      {showSource ? (
        <pre className="generic-source">{document.rawSource}</pre>
      ) : (
        <div className="generic-tree">
          {document.genericRoot
            ? <NodeView node={document.genericRoot} />
            : <div className="empty-search">XML 内容为空</div>}
        </div>
      )}
    </div>
  );
}
