/**
 * Each organization lives in its own store. Its letter starts every session token (d_…), lesson link (D-…) and section
 * code (DG-…) it issues, so a request reaches its store before anything is read. The first one is the default.
 */
export const organizations = [
  { id: "org-demo", letter: "d", fictional: true },
  { id: "org-other", letter: "o", fictional: true },
  { id: "org-hl", letter: "h", fictional: false },
] as const;
export type OrganizationId = typeof organizations[number]["id"];

const byId = (id: string) => organizations.find(item => item.id === id) || organizations[0];
const byLetter = (letter: string | undefined) => organizations.find(item => item.letter === letter?.toLowerCase()) || organizations[0];
const letters = organizations.map(item => item.letter).join("");

export const organizationIds: readonly string[] = organizations.map(item => item.id);
/** Whether the organization holds only invented people and records, as the demonstrations do. */
export const fictional = (id: string) => byId(id).fictional;
export const tokenPrefix = (id: string) => `${byId(id).letter}_`;
export const sharePrefix = (id: string) => `${byId(id).letter.toUpperCase()}-`;
export const sectionPrefix = (id: string) => `${byId(id).letter.toUpperCase()}G`;
export const tokenPattern = new RegExp(`^[${letters}]_[a-f0-9]{64}$`);
export const scopeOfToken = (token: string | null | undefined) => byLetter(token && /^[a-z]_/.test(token) ? token[0] : undefined).id;
export const scopeOfShare = (code: string) => byLetter(/^[A-Z]-/.test(code) ? code[0] : undefined).id;
export const scopeOfSection = (code: string) => byLetter(/^[A-Z]G-/.test(code) ? code[0] : undefined).id;
