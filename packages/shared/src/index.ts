import { z } from "zod";

/**
 * Shared zod schemas + types: domain, job payloads, API contracts, prompt
 * templates (TECH_SPEC §3). Contracts land here as their backend phase starts —
 * migration 0001 (issue #5) brings the domain enums, Phase 1 the upload/job
 * contracts. Consumed as TypeScript source (apps/web has `transpilePackages`).
 */

// Seed: workspace roles per TECH_SPEC §4 `member_role` — referenced by both
// the web app (membership UI) and the worker (nothing yet).
export const memberRoleSchema = z.enum(["owner", "editor", "viewer"]);
export type MemberRole = z.infer<typeof memberRoleSchema>;

// Job queue contracts per TECH_SPEC §4 `job_type` / `job_status` — the wire
// format between web (enqueue via POST /api/jobs) and the worker (claim loop).
export const jobTypeSchema = z.enum(["ingest", "analyze", "caption", "export"]);
export type JobType = z.infer<typeof jobTypeSchema>;

export const jobStatusSchema = z.enum(["queued", "running", "done", "failed", "canceled"]);
export type JobStatus = z.infer<typeof jobStatusSchema>;
