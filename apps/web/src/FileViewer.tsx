import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import DOMPurify from "dompurify";
import { Icon } from "./ui/icons";

type Kind = "docx" | "pptx" | "xlsx" | "pdf" | "video";
const kindOf = (name: string): Kind | null => {
  const extension = name.split(".").pop()?.toLowerCase();
  return extension === "mp4" || extension === "webm" ? "video" : (["docx", "pptx", "xlsx", "pdf"] as const).find(kind => kind === extension) || null;
};
const limits: Record<Kind, number> = { docx: 15, pptx: 15, xlsx: 15, pdf: 25, video: 100 };
const mediaTypes: Record<string, string> = { pdf: "application/pdf", mp4: "video/mp4", webm: "video/webm" };
const unitLabel: Partial<Record<Kind, [string, string]>> = { pptx: ["Diapositiva", "diapositivas"], pdf: ["Página", "páginas"] };

function cleanMarkup(target: HTMLElement) {
  const fragment = DOMPurify.sanitize(target.innerHTML, { RETURN_DOM_FRAGMENT: true, USE_PROFILES: { html: true, svg: true, svgFilters: false, mathMl: false } });
  target.replaceChildren(fragment);
  for (const link of target.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    if (!/^https?:\/\//i.test(link.href)) { link.removeAttribute("href"); continue; }
    link.target = "_blank"; link.rel = "noopener noreferrer";
  }
}

type Pager = { count: number; go: (index: number) => Promise<void> | void; resize?: () => void };

/**
 * Viewer for private course files. Fills the space it is given, pages through presentations and PDFs,
 * and can go full screen for presenting. Everything renders locally; nothing is sent to other services.
 */
export function FileViewer({ url, name, fill = false }: { url: string; name: string; mediaType?: string; fill?: boolean }) {
  const root = useRef<HTMLElement>(null), stage = useRef<HTMLDivElement>(null), pager = useRef<Pager | null>(null);
  const [status, setStatus] = useState("Cargando archivo…"), [error, setError] = useState("");
  const [page, setPage] = useState(0), [count, setCount] = useState(0), [fullscreen, setFullscreen] = useState(false), [ratio, setRatio] = useState(16 / 9);
  const [videoUrl, setVideoUrl] = useState("");
  const kind = kindOf(name);

  useEffect(() => {
    const element = stage.current;
    const controller = new AbortController();
    let cancelled = false, cleanup = () => {};
    if (!element || !kind) { setError("Este formato no tiene vista previa disponible."); return; }
    setStatus("Cargando archivo…"); setError(""); setPage(0); setCount(0); element.replaceChildren(); pager.current = null;
    void (async () => {
      try {
        const response = await fetch(url, { credentials: "same-origin", cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("No se pudo abrir este archivo. Vuelve a intentarlo o descárgalo.");
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength > limits[kind] * 1024 * 1024) throw new Error(`El archivo supera el límite de vista previa de ${limits[kind]} MB.`);
        if (cancelled) return;
        if (kind === "video") {
          const objectUrl = URL.createObjectURL(new Blob([buffer], { type: mediaTypes[name.split(".").pop()!.toLowerCase()] }));
          setVideoUrl(objectUrl); cleanup = () => URL.revokeObjectURL(objectUrl);
        } else if (kind === "docx") {
          const { renderAsync } = await import("docx-preview");
          await renderAsync(new Blob([buffer]), element, undefined, { renderComments: false, renderChanges: false, renderAltChunks: false, useBase64URL: false, ignoreFonts: true, ignoreWidth: true, ignoreHeight: true, breakPages: false });
          if (cancelled) return;
          cleanMarkup(element);
        } else if (kind === "pptx") {
          const { PptxViewer, RECOMMENDED_ZIP_LIMITS } = await import("@aiden0z/pptx-renderer");
          const viewer = await PptxViewer.open(buffer, element, { renderMode: "slide", fitMode: "contain", zipLimits: RECOMMENDED_ZIP_LIMITS, lazySlides: true, lazyMedia: true, onSlideRendered: () => cleanMarkup(element) });
          cleanup = () => viewer.destroy?.();
          if (cancelled) return;
          if (viewer.slideWidth && viewer.slideHeight) setRatio(viewer.slideWidth / viewer.slideHeight);
          pager.current = { count: viewer.slideCount, go: index => viewer.goToSlide(index) };
          setCount(viewer.slideCount);
        } else if (kind === "pdf") {
          const pdfjs = await import("pdfjs-dist");
          pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
          const loading = pdfjs.getDocument({ data: new Uint8Array(buffer), enableXfa: false });
          cleanup = () => { void loading.destroy(); };
          const pdf = await loading.promise;
          if (cancelled) return;
          const canvas = document.createElement("canvas");
          canvas.setAttribute("role", "img");
          element.append(canvas);
          let current = 0, task: { cancel: () => void } | null = null;
          const draw = async (index: number) => {
            current = index;
            const pdfPage = await pdf.getPage(index + 1);
            const base = pdfPage.getViewport({ scale: 1 });
            setRatio(base.width / base.height);
            const box = element.getBoundingClientRect();
            const scale = Math.min(box.width / base.width, (box.height || Infinity) / base.height) || 1;
            const viewport = pdfPage.getViewport({ scale: scale * (window.devicePixelRatio || 1) });
            canvas.width = viewport.width; canvas.height = viewport.height;
            canvas.style.width = `${viewport.width / (window.devicePixelRatio || 1)}px`;
            canvas.setAttribute("aria-label", `Página ${index + 1} de ${pdf.numPages} de ${name}`);
            task?.cancel();
            const render = pdfPage.render({ canvas, viewport });
            task = render;
            await render.promise.catch(() => undefined);
          };
          pager.current = { count: pdf.numPages, go: draw, resize: () => void draw(current) };
          setCount(pdf.numPages);
          await draw(0);
        } else {
          const readXlsxFile = (await import("read-excel-file/browser")).default;
          const sheets = await readXlsxFile(new Blob([buffer]));
          if (cancelled) return;
          const sheetSelect = document.createElement("select");
          sheetSelect.setAttribute("aria-label", "Hoja de cálculo");
          const content = document.createElement("div");
          content.className = "spreadsheet-scroll";
          const renderSheet = (index: number) => {
            const table = document.createElement("table");
            table.className = "spreadsheet-preview";
            for (const row of sheets[index].data.slice(0, 250)) {
              const tr = document.createElement("tr");
              for (const cell of row.slice(0, 40)) {
                const td = document.createElement("td");
                td.textContent = cell instanceof Date ? cell.toLocaleDateString() : cell == null ? "" : String(cell).slice(0, 2000);
                tr.append(td);
              }
              table.append(tr);
            }
            content.replaceChildren(table);
          };
          for (const [index, sheet] of sheets.entries()) { const option = document.createElement("option"); option.value = String(index); option.textContent = sheet.sheet.slice(0, 100); sheetSelect.append(option); }
          sheetSelect.addEventListener("change", () => renderSheet(Number(sheetSelect.value)));
          element.append(sheetSelect, content); renderSheet(0);
        }
        if (!cancelled) setStatus("");
      } catch (cause) {
        if (!cancelled && !controller.signal.aborted) { setError(cause instanceof Error ? cause.message : "No se pudo mostrar el archivo."); setStatus(""); }
      }
    })();
    return () => { cancelled = true; controller.abort(); cleanup(); element.replaceChildren(); setVideoUrl(""); };
  }, [url, name, kind]);

  // Re-fit PDFs when the viewer changes size (window, layout or full screen).
  useEffect(() => {
    const element = stage.current;
    if (!element || kind !== "pdf") return;
    let frame = 0;
    const observer = new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => pager.current?.resize?.()); });
    observer.observe(element);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [kind]);
  useEffect(() => {
    const change = () => setFullscreen(document.fullscreenElement === root.current);
    document.addEventListener("fullscreenchange", change);
    return () => document.removeEventListener("fullscreenchange", change);
  }, []);

  const go = useCallback((index: number) => {
    if (!pager.current || index < 0 || index >= pager.current.count) return;
    setPage(index); void pager.current.go(index);
  }, []);
  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void root.current?.requestFullscreen?.().catch(() => setError("Tu navegador no permite la pantalla completa aquí."));
  }
  function keys(event: KeyboardEvent) {
    if ((event.target as HTMLElement).closest("input,select,textarea,video")) return;
    if (["ArrowRight", "PageDown", " "].includes(event.key) && count) { event.preventDefault(); go(page + 1); }
    if (["ArrowLeft", "PageUp"].includes(event.key) && count) { event.preventDefault(); go(page - 1); }
  }
  const [one, many] = unitLabel[kind || "docx"] || ["", ""];
  return <section ref={root} className={`file-viewer kind-${kind || "unknown"}${fill ? " fill" : ""}${fullscreen ? " is-fullscreen" : ""}`} aria-label={`Visor de ${name}`} tabIndex={-1} onKeyDown={keys} style={{ ["--ratio" as string]: ratio }}>
    <div className="viewer-toolbar">
      <span className="viewer-name"><Icon name={kind === "video" ? "play" : kind === "pptx" ? "present" : "file"} size={18}/><span>{name}</span></span>
      {count > 0 && <span className="viewer-pager">
        <button type="button" className="icon-button small" aria-label={`${one} anterior`} disabled={page === 0} onClick={() => go(page - 1)}><Icon name="back" size={18}/></button>
        <span aria-live="polite">{one} {page + 1} de {count}<span className="sr-only"> {many}</span></span>
        <button type="button" className="icon-button small" aria-label={`${one} siguiente`} disabled={page >= count - 1} onClick={() => go(page + 1)}><Icon name="chevronRight" size={18}/></button>
      </span>}
      <span className="viewer-actions">
        <a className="icon-button small" href={url} download={name} aria-label={`Descargar ${name}`} title="Descargar original"><Icon name="download" size={18}/></a>
        <button type="button" className="button secondary small" onClick={toggleFullscreen} aria-pressed={fullscreen}><Icon name={fullscreen ? "close" : "expand"} size={16}/>{fullscreen ? "Salir" : kind === "pptx" ? "Presentar" : "Pantalla completa"}</button>
      </span>
    </div>
    {status && <p className="viewer-status" role="status"><span className="spinner" aria-hidden="true"/>{status}</p>}
    {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
    <div className="viewer-frame"><div ref={stage} className="viewer-stage" onClick={event => { if (kind === "pptx" && fullscreen && !(event.target as HTMLElement).closest("a,button")) go(page + 1); }}/></div>
    {kind === "video" && videoUrl && <video className="viewer-video" src={videoUrl} controls playsInline preload="metadata" aria-label={name}/>}
    <p className="viewer-note">Vista local y privada; el archivo no se envía a servicios externos.{count > 1 ? " Usa ← y → para avanzar." : ""}</p>
  </section>;
}
