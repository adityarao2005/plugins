/**
 * A tiny, dependency-free text utility module.
 *
 * It only relies on standard ECMAScript features, so the compiled output is
 * safe to ship to the browser, Node, Bun, Deno, or any edge runtime.
 */

export interface SlugifyOptions {
  /** String used to join words. Defaults to `"-"`. */
  separator?: string;
  /** Lowercase the result. Defaults to `true`. */
  lowercase?: boolean;
}

/**
 * Convert an arbitrary string into a URL-friendly slug.
 *
 * @example
 * slugify("Hello, World!"); // "hello-world"
 * slugify("Crème Brûlée");  // "creme-brulee"
 */
export function slugify(input: string, options: SlugifyOptions = {}): string {
  const { separator = "-", lowercase = true } = options;
  const escaped = escapeRegExp(separator);

  const result = input
    .normalize("NFKD")
    // Strip combining diacritical marks left over from `normalize`.
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, separator)
    .replace(new RegExp(`^${escaped}+|${escaped}+$`, "g"), "");

  return lowercase ? result.toLowerCase() : result;
}

/**
 * Convert a string to Title Case.
 *
 * @example
 * titleCase("hello WORLD"); // "Hello World"
 */
export function titleCase(input: string): string {
  return input.replace(
    /\w\S*/g,
    (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
