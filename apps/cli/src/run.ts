import { slugify, titleCase } from "@repo/core";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

const USAGE = `repo-cli - a tiny cross-runtime CLI example

Usage:
  repo-cli <command> [input...]

Commands:
  slugify <input...>   Convert text to a URL-friendly slug
  title <input...>     Convert text to Title Case
  help                 Show this message

Examples:
  repo-cli slugify "Hello, World!"
  repo-cli title "hello there"`;

/**
 * Pure entry point: takes argv (without the runtime/script prefix) and returns
 * the output plus an exit code. Keeping I/O in `index.ts` makes this testable
 * without spawning a process.
 */
export function run(argv: string[]): RunResult {
  const [command, ...rest] = argv;
  const input = rest.join(" ");

  switch (command) {
    case "slugify":
      if (input.length === 0) return fail("slugify requires an input string");
      return ok(slugify(input));
    case "title":
      if (input.length === 0) return fail("title requires an input string");
      return ok(titleCase(input));
    case "help":
    case "--help":
    case "-h":
    case undefined:
      return ok(USAGE);
    default:
      return fail(`unknown command: ${command}`);
  }
}

function ok(stdout: string): RunResult {
  return { code: 0, stdout, stderr: "" };
}

function fail(message: string): RunResult {
  return {
    code: 1,
    stdout: "",
    stderr: `error: ${message}\nRun "repo-cli help" for usage.`,
  };
}
