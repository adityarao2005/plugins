#!/usr/bin/env node
import { run } from "./run";

const result = run(process.argv.slice(2));

if (result.stdout.length > 0) process.stdout.write(`${result.stdout}\n`);
if (result.stderr.length > 0) process.stderr.write(`${result.stderr}\n`);

process.exitCode = result.code;
