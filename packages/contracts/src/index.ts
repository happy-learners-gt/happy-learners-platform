export interface HealthResponse { status: "ok" }
export interface VersionResponse { sha: string }
export interface Member { id: string; username: string; role: "admin" | "instructor"; organizationId: string }
export interface Organization { id: string; name: string | null; timezone: string; configured: boolean }
export interface Lesson {
  id: string; title: string; program: string; duration: number; objective: string;
  materials: string[]; activities: { title: string; minutes: number; instructions: string }[];
  reflection: string; publishedAt: string;
}
