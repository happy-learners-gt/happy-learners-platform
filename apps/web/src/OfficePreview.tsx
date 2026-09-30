import { useEffect, useRef, useState } from "react";
import DOMPurify from "dompurify";

type OfficePreviewProps = { url: string; name: string; mediaType?: string };
const MAX_FILE_BYTES = 15 * 1024 * 1024;

function cleanMarkup(target: HTMLElement) {
  const fragment = DOMPurify.sanitize(target.innerHTML, { RETURN_DOM_FRAGMENT: true, USE_PROFILES: { html: true, svg: true, svgFilters: false, mathMl: false } });
  target.replaceChildren(fragment);
  for (const link of target.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    if (!/^https?:\/\//i.test(link.href)) { link.removeAttribute("href"); continue; }
    link.target = "_blank"; link.rel = "noopener noreferrer";
  }
}

export function OfficePreview({ url, name, mediaType }: OfficePreviewProps) {
  const target = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("Cargando documento…");
  const [error, setError] = useState("");
  const extension = name.split(".").pop()?.toLowerCase();

  useEffect(() => {
    const element = target.current;
    const controller = new AbortController();
    let viewer: { destroy?: () => void } | undefined;
    let cancelled = false;
    if (!element || !["docx", "pptx", "xlsx"].includes(extension || "")) {
      setError("Este formato no tiene vista previa disponible.");
      return;
    }
    setStatus("Cargando documento…"); setError(""); element.replaceChildren();
    void (async () => {
      try {
        const response = await fetch(url, { credentials: "same-origin", cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("No se pudo abrir este documento.");
        const length = Number(response.headers.get("Content-Length"));
        if (Number.isFinite(length) && length > MAX_FILE_BYTES) throw new Error("El documento supera el límite de vista previa de 15 MB.");
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength > MAX_FILE_BYTES) throw new Error("El documento supera el límite de vista previa de 15 MB.");
        if (mediaType && response.headers.get("Content-Type")?.includes("text/html")) throw new Error("La respuesta no es un archivo Office válido.");
        if (cancelled) return;

        if (extension === "docx") {
          const { renderAsync } = await import("docx-preview");
          await renderAsync(new Blob([buffer]), element, undefined, { renderComments: false, renderChanges: false, renderAltChunks: false, useBase64URL: false, ignoreFonts: true, ignoreWidth: true, ignoreHeight: true, breakPages: false });
          if (cancelled) return;
          cleanMarkup(element);
        } else if (extension === "pptx") {
          const { PptxViewer, RECOMMENDED_ZIP_LIMITS } = await import("@aiden0z/pptx-renderer");
          viewer = await PptxViewer.open(buffer, element, { zipLimits: RECOMMENDED_ZIP_LIMITS, lazySlides: true, lazyMedia: true, listOptions: { windowed: true, initialSlides: 3, batchSize: 3 } });
          if (cancelled) { viewer.destroy?.(); return; }
          cleanMarkup(element);
        } else {
          const readXlsxFile = (await import("read-excel-file/browser")).default;
          const sheets = await readXlsxFile(new Blob([buffer]));
          if (cancelled) return;
          const sheetSelect = document.createElement("select");
          sheetSelect.setAttribute("aria-label", "Hoja de cálculo");
          const content = document.createElement("div");
          content.className = "spreadsheet-scroll";
          const renderSheet = (index: number) => {
            const sheet = sheets[index];
            const table = document.createElement("table");
            table.className = "spreadsheet-preview";
            for (const row of sheet.data.slice(0, 250)) {
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
          for (const [index, sheet] of sheets.entries()) {
            const option = document.createElement("option"); option.value = String(index); option.textContent = sheet.sheet.slice(0, 100); sheetSelect.append(option);
          }
          sheetSelect.addEventListener("change", () => renderSheet(Number(sheetSelect.value)));
          element.append(sheetSelect, content); renderSheet(0);
        }
        if (!cancelled) setStatus("Vista previa lista. El documento permanece privado.");
      } catch (cause) {
        if (!cancelled && !controller.signal.aborted) { setError(cause instanceof Error ? cause.message : "No se pudo previsualizar el documento."); setStatus(""); }
      }
    })();
    return () => { cancelled = true; controller.abort(); viewer?.destroy?.(); element.replaceChildren(); };
  }, [url, name, extension, mediaType]);

  return <section className="office-preview" aria-label={`Vista previa de ${name}`}>
    <div className="office-preview-heading"><div><strong>{name}</strong><small>Vista local y privada · no se envía a servicios externos</small></div><a href={url} download={name}>Descargar original</a></div>
    {status && <p role="status">{status}</p>}{error && <p className="alert error" role="alert">{error}</p>}
    <div ref={target} className="office-preview-content" />
  </section>;
}
