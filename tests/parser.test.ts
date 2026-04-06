import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseReadme } from "../src/parser.ts";
import type { RepoConfig } from "../src/types.ts";

const negarConfig: RepoConfig = {
  owner: "negarprh",
  repo: "Canadian-Tech-Internships-2026",
  branch: "main",
  columns: { company: 0, role: 1, location: 2, apply: 3, datePosted: 4 },
};

const hanziliConfig: RepoConfig = {
  owner: "hanzili",
  repo: "canada_sde_intern_position",
  branch: "main",
  columns: { company: 1, role: 2, location: 5, apply: 6 },
};

describe("parseReadme — negarprh format", () => {
  const markdown = `
# Canadian Tech Internships 2026

| Company | Role | Location | Apply | Date Posted |
|--------|------|----------|:-----:|--------------|
| BMO | Software Developer Intern | Toronto, ON | [![Apply](https://img.shields.io/badge/-Apply-blue?style=for-the-badge)](https://jobs.bmo.com/12345) | Apr 6, 2026 |
| Google | SWE Intern | Waterloo, ON | [![Apply](https://img.shields.io/badge/-Apply-blue?style=for-the-badge)](https://careers.google.com/99) | Apr 5, 2026 |
`;

  it("parses all rows", () => {
    const rows = parseReadme(markdown, negarConfig);
    assert.equal(rows.length, 2);
  });

  it("extracts company, role, location", () => {
    const rows = parseReadme(markdown, negarConfig);
    assert.equal(rows[0].company, "BMO");
    assert.equal(rows[0].role, "Software Developer Intern");
    assert.equal(rows[0].location, "Toronto, ON");
  });

  it("extracts apply URL from shield badge", () => {
    const rows = parseReadme(markdown, negarConfig);
    assert.equal(rows[0].applyUrl, "https://jobs.bmo.com/12345");
  });

  it("extracts date posted", () => {
    const rows = parseReadme(markdown, negarConfig);
    assert.equal(rows[0].datePosted, "Apr 6, 2026");
  });

  it("sets repoSource", () => {
    const rows = parseReadme(markdown, negarConfig);
    assert.equal(rows[0].repoSource, "negarprh/Canadian-Tech-Internships-2026");
  });
});

describe("parseReadme — hanzili format", () => {
  const markdown = `
# Canada SDE Intern

| Title | Company | Role | Company Info | Details | Location | Apply |
|-------|---------|------|--------------|---------|----------|:-----:|
| Software Engineer Intern <!--id:123--> | Acme Corp | Build APIs | Startup in Toronto | Intern · 4mo | Toronto, Ontario (Hybrid) | [Apply](<https://example.com/apply>) |
`;

  it("parses row with correct column mapping", () => {
    const rows = parseReadme(markdown, hanziliConfig);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].company, "Acme Corp");
    assert.equal(rows[0].role, "Build APIs");
    assert.equal(rows[0].location, "Toronto, Ontario (Hybrid)");
  });

  it("extracts apply URL from plain link", () => {
    const rows = parseReadme(markdown, hanziliConfig);
    assert.equal(rows[0].applyUrl, "https://example.com/apply");
  });

  it("strips HTML comments from cells", () => {
    const rows = parseReadme(markdown, hanziliConfig);
    assert.ok(!rows[0].role.includes("<!--"));
  });
});

describe("parseReadme — edge cases", () => {
  it("returns empty array for markdown with no table", () => {
    const rows = parseReadme("# Just a heading\n\nSome text.", negarConfig);
    assert.equal(rows.length, 0);
  });

  it("skips rows with empty company", () => {
    const markdown = `
| Company | Role | Location | Apply | Date Posted |
|--------|------|----------|:-----:|--------------|
|  | Some Role | Toronto | [Apply](https://x.com) | Apr 1 |
`;
    const rows = parseReadme(markdown, negarConfig);
    assert.equal(rows.length, 0);
  });
});
