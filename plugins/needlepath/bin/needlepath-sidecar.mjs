#!/usr/bin/env node

import { runSidecar } from "../src/hook.mjs";

let input = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) input += chunk;
process.exitCode = await runSidecar({ argv: process.argv.slice(2), stdin: input });
