import type { BibliographyRole } from "@happy-learners/contracts";

/**
 * The course's bibliography. Each reference points to an item of the course's library (no second storage) and has a
 * role: the course's texts, support material or other. One of the texts may be the course's main book; choosing
 * another main book replaces it. The main book must be published, like everything students and lessons rely on.
 */
export const bibliographyRoles: { value: BibliographyRole; label: string; description: string }[] = [
  { value: "text", label: "Texto", description: "Libro o texto que el curso sigue." },
  { value: "support", label: "Apoyo", description: "Material que complementa los textos." },
  { value: "other", label: "Otro", description: "Cualquier otra referencia del curso." },
];
export const bibliographyRoleLabel = (role: BibliographyRole) => bibliographyRoles.find(item => item.value === role)?.label || role;
export const isBibliographyRole = (value: unknown): value is BibliographyRole => bibliographyRoles.some(item => item.value === value);
export const maxCitation = 300, maxReferences = 60;

/** A reference's role, citation (author, publisher, year…) and whether it is the main book; or what to fix. */
export function referenceInput(input: unknown): { role: BibliographyRole; citation: string; primary: boolean } | { error: string } {
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
  if (!isBibliographyRole(value.role)) return { error: "Elige el rol de la referencia: texto, apoyo u otro." };
  const citation = value.citation === undefined || value.citation === null ? "" : typeof value.citation === "string" ? value.citation.trim().replace(/\s+/g, " ").normalize("NFC") : null;
  if (citation === null || citation.length > maxCitation || /[<>]/.test(citation)) return { error: `La cita admite hasta ${maxCitation} caracteres, sin < ni >.` };
  if (value.primary !== undefined && typeof value.primary !== "boolean") return { error: "Indica si es el libro principal." };
  const primary = value.primary === true;
  if (primary && value.role !== "text") return { error: "El libro principal debe tener el rol «Texto»." };
  return { role: value.role, citation, primary };
}

/** Why an item cannot be the course's main book, or null when it can. */
export function primaryBlocker(status: "draft" | "published" | "archived") {
  if (status === "archived") return "Un recurso archivado no puede ser el libro principal.";
  if (status === "draft") return "Publica el recurso antes de marcarlo como libro principal.";
  return null;
}
