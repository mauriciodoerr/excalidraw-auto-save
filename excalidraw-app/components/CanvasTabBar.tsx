import React, { useRef, useState } from "react";
import type { CanvasMeta } from "../canvasManager";
import "./CanvasTabBar.scss";

export const CanvasTabBar: React.FC<{
  canvases: CanvasMeta[];
  activeId: string;
  onSwitch: (id: string) => void;
  onAdd: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}> = ({ canvases, activeId, onSwitch, onAdd, onRename, onDelete }) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const startRename = (canvas: CanvasMeta) => {
    setEditingId(canvas.id);
    setEditingName(canvas.name);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const commitRename = () => {
    if (editingId && editingName.trim()) {
      onRename(editingId, editingName.trim());
    }
    setEditingId(null);
  };

  return (
    <div className="canvas-tab-bar">
      {canvases.map((canvas) => (
        <div
          key={canvas.id}
          className={`canvas-tab${canvas.id === activeId ? " canvas-tab--active" : ""}`}
          onClick={() => {
            if (editingId !== canvas.id) onSwitch(canvas.id);
          }}
          onDoubleClick={() => startRename(canvas)}
          title={canvas.name}
        >
          {editingId === canvas.id ? (
            <input
              ref={inputRef}
              className="canvas-tab__rename-input"
              value={editingName}
              onChange={(e) => setEditingName(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") setEditingId(null);
                e.stopPropagation();
              }}
              onClick={(e) => e.stopPropagation()}
              autoFocus
            />
          ) : (
            <span className="canvas-tab__name">{canvas.name}</span>
          )}
          {canvases.length > 1 && (
            <button
              className="canvas-tab__delete"
              title="Delete canvas"
              onClick={(e) => {
                e.stopPropagation();
                if (window.confirm(`Delete canvas "${canvas.name}"? This cannot be undone.`)) {
                  onDelete(canvas.id);
                }
              }}
            >
              ×
            </button>
          )}
        </div>
      ))}
      <button className="canvas-tab-bar__add" onClick={onAdd} title="New canvas">
        +
      </button>
    </div>
  );
};
