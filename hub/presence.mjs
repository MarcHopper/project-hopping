// Are you actually at the Mac right now? Uses macOS HID idle time (seconds since
// the last keyboard/mouse input). Lets the hub send Slack ONLY when you've
// stepped away — while you're working in VS Code, a desktop banner is enough.

import { execSync } from "node:child_process";

export function idleSeconds() {
  try {
    const out = execSync("ioreg -c IOHIDSystem | grep -m1 HIDIdleTime", {
      encoding: "utf8",
      timeout: 2000,
    });
    const m = out.match(/=\s*(\d+)/);
    if (!m) return 0;
    return Math.floor(Number(m[1]) / 1e9); // nanoseconds → seconds
  } catch {
    return 99999; // can't tell → assume AWAY so alerts still reach Slack
  }
}

// Active if input happened within `thresholdSec`. Env override for tuning.
export function userIsActive(thresholdSec) {
  const t = thresholdSec ?? Number(process.env.HOPPING_ACTIVE_SEC ?? 180);
  return idleSeconds() < t;
}
