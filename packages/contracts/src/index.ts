export interface HealthResponse { status: "ok" }
export interface VersionResponse { sha: string }
export type Skill = "lectura" | "escritura" | "escucha" | "conversación";
export type ResourceStatus = "borrador" | "publicado";
export interface Resource { id: string; title: string; description: string; level: string; skill: Skill; topic: string; tags: string[]; content: string; status: ResourceStatus; }
export interface Lesson { id: string; title: string; objective: string; instructions: string; resourceIds: string[]; published: boolean; shareCode: string; completedCount: number; }
export interface Session { user: string; role: "educador"; }
export interface CatalogResponse { resources: Resource[]; lessons: Lesson[]; }
