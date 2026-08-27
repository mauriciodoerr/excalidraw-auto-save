import { loadFromBlob } from "@excalidraw/excalidraw/data/blob";
import type { ImportedDataState } from "@excalidraw/excalidraw/data/types";

const CANVAS_LIST_KEY = "excalidraw-canvas-list";

export type CanvasMeta = { id: string; name: string };

function generateId(): string {
  return `canvas-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function listCanvases(): CanvasMeta[] {
  try {
    const raw = localStorage.getItem(CANVAS_LIST_KEY);
    if (raw) return JSON.parse(raw) as CanvasMeta[];
  } catch {}
  // First run: seed with the legacy default canvas
  const initial: CanvasMeta[] = [{ id: "default", name: "Drawing" }];
  localStorage.setItem(CANVAS_LIST_KEY, JSON.stringify(initial));
  return initial;
}

function persistList(canvases: CanvasMeta[]): void {
  localStorage.setItem(CANVAS_LIST_KEY, JSON.stringify(canvases));
}

export function addCanvas(name: string): CanvasMeta {
  const canvases = listCanvases();
  const meta: CanvasMeta = { id: generateId(), name };
  canvases.push(meta);
  persistList(canvases);
  return meta;
}

export function renameCanvas(id: string, name: string): void {
  const canvases = listCanvases().map((c) =>
    c.id === id ? { ...c, name } : c,
  );
  persistList(canvases);
}

export function removeCanvas(id: string): void {
  const canvases = listCanvases().filter((c) => c.id !== id);
  persistList(canvases);
}

export async function loadCanvasFromServer(
  id: string,
): Promise<ImportedDataState | null> {
  try {
    const res = await fetch(`/api/canvas/${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await loadFromBlob(blob, null, null);
  } catch {
    return null;
  }
}

export async function deleteCanvasOnServer(id: string): Promise<void> {
  await fetch(`/api/canvas/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(
    () => {},
  );
}

export async function syncCanvasesWithServer(): Promise<CanvasMeta[]> {
  const res = await fetch("/api/canvases");
  const data = await res.json();
  if (!data.ok) throw new Error(data.error);

  const serverIds: string[] = data.canvases.map((c: { id: string }) => c.id);
  const local = listCanvases();
  const localById = new Map(local.map((c) => [c.id, c]));

  // Preserve user-set names for existing canvases; use id as name for new ones
  const merged: CanvasMeta[] = serverIds.map((id) =>
    localById.get(id) ?? { id, name: id },
  );

  if (merged.length === 0) merged.push({ id: "default", name: "Drawing" });

  persistList(merged);
  return merged;
}
