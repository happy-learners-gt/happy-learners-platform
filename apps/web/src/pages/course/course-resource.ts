import type { ResourceAuthor, ResourceLicense, ResourceRole, ResourceType } from "@happy-learners/domain";
import { resourceRoleLabel } from "@happy-learners/domain";

/** One library item with its record, as GET /courses/:id/resources returns it. */
export type CourseResource = {
  id: string;
  courseId: string;
  materialId: string | null;
  fileId: string | null;
  kind: "file" | "link" | "text" | "reference";
  type: ResourceType;
  title: string;
  authors: ResourceAuthor[];
  year: number | null;
  metadata: Record<string, string | number | null>;
  language: string;
  license: ResourceLicense | string;
  shareable: boolean;
  level: string;
  area: string;
  role: ResourceRole | null;
  citationOverride: string | null;
  citation: string;
  manual: boolean;
  status: "draft" | "published" | "archived";
  updatedAt: string;
  fileName?: string;
  mediaType?: string;
  indexState: "none" | "ready" | "mapped";
  coverage?: { confirmed: number; total: number };
};

export type PlanCoverage = {
  covered: number;
  total: number;
  byOutcome: { outcomeId: string; resources: { resourceId: string; title: string; pages: number[]; chapter: string | null }[] }[];
};

export const indexStateLabel = (item: CourseResource) =>
  item.indexState === "mapped" ? `Indexado · ${item.coverage?.confirmed || 0} de ${item.coverage?.total || 0}` : item.indexState === "ready" ? "Índice listo" : "Sin índice";

export const roleText = (role: ResourceRole | null) => role ? `${resourceRoleLabel[role]}${role === "primary" ? " ★" : ""}` : "—";

export const licenseLabel: Record<string, string> = {
  reserved: "Derechos reservados",
  "cc-by": "CC BY",
  "cc-by-sa": "CC BY-SA",
  "cc-by-nc": "CC BY-NC",
  "public-domain": "Dominio público",
  internal: "Uso interno",
};

export const kindLabel = { file: "Archivo", link: "Enlace", text: "Texto", reference: "Solo referencia" } as const;
