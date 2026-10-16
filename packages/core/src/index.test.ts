import { describe, expect, test } from "bun:test";

import { slugify, titleCase } from "./index";

describe("slugify", () => {
  test("lowercases and hyphenates", () => {
    expect(slugify("Hello, World!")).toBe("hello-world");
  });

  test("strips diacritics", () => {
    expect(slugify("Crème Brûlée")).toBe("creme-brulee");
  });

  test("supports a custom separator", () => {
    expect(slugify("Hello World", { separator: "_" })).toBe("hello_world");
  });

  test("can preserve casing", () => {
    expect(slugify("Hello World", { lowercase: false })).toBe("Hello-World");
  });
});

describe("titleCase", () => {
  test("capitalizes every word", () => {
    expect(titleCase("hello WORLD")).toBe("Hello World");
  });
});
