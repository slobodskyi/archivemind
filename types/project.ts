import type { ProjectKey, PhotoGroup, PhotoSource } from "./photo";

export interface Project {
  key: ProjectKey | "all";
  label: string;
  color: string;
  count: number;
}

export interface GroupMeta {
  key: PhotoGroup;
  label: string;
  color: string;
}

export interface SourceMeta {
  key: PhotoSource;
  label: string;
  color: string;
  abbr: string;
}
