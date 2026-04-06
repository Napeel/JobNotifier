import { createHash } from "node:crypto";

export interface PostingRow {
  company: string;
  role: string;
  location: string;
  applyUrl: string;
  datePosted?: string;
  repoSource: string;
}

export interface RepoConfig {
  owner: string;
  repo: string;
  branch: string;
  columns: {
    company: number;
    role: number;
    location: number;
    apply: number;
    datePosted?: number;
  };
}

export const REPOS: RepoConfig[] = [
  {
    owner: "negarprh",
    repo: "Canadian-Tech-Internships-2026",
    branch: "main",
    columns: { company: 0, role: 1, location: 2, apply: 3, datePosted: 4 },
  },
  {
    owner: "hanzili",
    repo: "canada_sde_intern_position",
    branch: "main",
    columns: { company: 1, role: 2, location: 5, apply: 6 },
  },
];

export function hashPosting(row: PostingRow): string {
  const key = `${row.company}|${row.role}|${row.location}`.toLowerCase().trim();
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}
