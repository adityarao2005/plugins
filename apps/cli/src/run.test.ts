import { describe, expect, test } from "bun:test";

import { run } from "./run";

describe("repo-cli", () => {
  test("slugify joins and slugifies its input", () => {
    const result = run(["slugify", "Hello,", "World!"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("hello-world");
  });

  test("title converts its input to title case", () => {
    const result = run(["title", "hello", "there"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("Hello There");
  });

  test("help (and no args) exits 0", () => {
    expect(run(["help"]).code).toBe(0);
    expect(run([]).code).toBe(0);
  });

  test("unknown commands exit 1", () => {
    const result = run(["nope"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("unknown command");
  });
});
