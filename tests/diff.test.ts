import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hashPosting } from "../src/types.ts";
import type { PostingRow } from "../src/types.ts";

function makeRow(company: string, role: string, location: string): PostingRow {
  return { company, role, location, applyUrl: "", repoSource: "test/repo" };
}

describe("hashPosting", () => {
  it("produces consistent hash for same input", () => {
    const a = hashPosting(makeRow("Google", "SWE Intern", "Toronto, ON"));
    const b = hashPosting(makeRow("Google", "SWE Intern", "Toronto, ON"));
    assert.equal(a, b);
  });

  it("is case insensitive", () => {
    const a = hashPosting(makeRow("google", "swe intern", "toronto, on"));
    const b = hashPosting(makeRow("Google", "SWE Intern", "Toronto, ON"));
    assert.equal(a, b);
  });

  it("produces different hashes for different postings", () => {
    const a = hashPosting(makeRow("Google", "SWE Intern", "Toronto"));
    const b = hashPosting(makeRow("Google", "PM Intern", "Toronto"));
    assert.notEqual(a, b);
  });
});

describe("diff logic", () => {
  it("identifies new postings not in known set", () => {
    const known = new Set(["hash1", "hash2"]);
    const current = [
      { hash: "hash1", row: makeRow("A", "R1", "L1") },
      { hash: "hash2", row: makeRow("B", "R2", "L2") },
      { hash: "hash3", row: makeRow("C", "R3", "L3") },
    ];
    const newPostings = current.filter((p) => !known.has(p.hash));
    assert.equal(newPostings.length, 1);
    assert.equal(newPostings[0].row.company, "C");
  });

  it("returns all postings when known set is empty", () => {
    const known = new Set<string>();
    const current = [
      { hash: "hash1", row: makeRow("A", "R1", "L1") },
      { hash: "hash2", row: makeRow("B", "R2", "L2") },
    ];
    const newPostings = current.filter((p) => !known.has(p.hash));
    assert.equal(newPostings.length, 2);
  });
});
