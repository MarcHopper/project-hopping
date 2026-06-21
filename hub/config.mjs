// Loads ~/.hopping.env (KEY=VALUE) into process.env so the hub reads Slack +
// Upstash config the same way in dev (`npm run hub`) and under launchd. Anything
// already in process.env (e.g. plist EnvironmentVariables) wins. Runs on import.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function loadEnv() {
  try {
    const txt = fs.readFileSync(path.join(os.homedir(), ".hopping.env"), "utf8");
    for (const line of txt.split("\n")) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const key = m[1];
      const val = m[2].trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = val; // env wins over file
    }
  } catch {
    /* no ~/.hopping.env yet — fine */
  }
}

loadEnv(); // populate on import

export function cfg() {
  return process.env;
}
