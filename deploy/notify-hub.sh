#!/bin/bash
# Project Hopping — Claude Code hook. POSTs an agent event to the local hub so
# the hop grid knows what each project is doing. Designed to be invisible:
# it never blocks a Claude turn and always exits 0, so a down hub or a bad
# payload can never break a Claude Code session.
#
# Installed at ~/.claude/hooks/notify-hub.sh and wired in ~/.claude/settings.json.
# Usage: notify-hub.sh <running|waiting|session_end|todo>
#   running|waiting|session_end  — SessionStart/UserPromptSubmit/Stop/SessionEnd
#   todo                          — PostToolUse(TodoWrite): syncs the chat's task list

TYPE="${1:-waiting}"
input="$(cat)"

# Working directory: prefer jq on the hook's stdin JSON, fall back to a sed
# parse (matching the existing notify-where.sh), then to $PWD.
cwd="$(printf '%s' "$input" | /usr/bin/jq -r '.cwd // empty' 2>/dev/null)"
[ -z "$cwd" ] && cwd="$(printf '%s' "$input" | sed -n 's/.*"cwd"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
[ -z "$cwd" ] && cwd="$PWD"

session="$(printf '%s' "$input" | /usr/bin/jq -r '.session_id // empty' 2>/dev/null)"

if [ "$TYPE" = "todo" ]; then
  # The todos array must ride through as JSON (not an --arg string), so build the
  # whole payload from the hook's stdin object in one jq transform. transcript_path
  # lets the hub drop TodoWrite calls made inside a subagent (its path has /subagents/).
  payload="$(printf '%s' "$input" | /usr/bin/jq -c \
    '{path:(.cwd // ""), type:"todo_update",
      payload:{session_id:(.session_id // ""),
               todos:(.tool_input.todos // []),
               transcript_path:(.transcript_path // ""),
               source:"claude-code"}}' 2>/dev/null)"
  [ -z "$payload" ] && exit 0
else
  case "$TYPE" in
    running)     etype="agent_running" ;;
    waiting)     etype="agent_waiting" ;;
    session_end) etype="session_end"   ;;
    *)           etype="agent_waiting" ;;
  esac
  payload="$(/usr/bin/jq -nc --arg p "$cwd" --arg t "$etype" --arg s "$session" \
    '{path:$p, type:$t, payload:{session_id:$s, source:"claude-code"}}' 2>/dev/null)"
  [ -z "$payload" ] && payload="{\"path\":\"$cwd\",\"type\":\"$etype\",\"payload\":{}}"
fi

# Fire-and-forget. 1s connect timeout so a stopped hub never delays Claude.
/usr/bin/curl -s -m 2 --connect-timeout 1 \
  -X POST "http://127.0.0.1:${HOPPING_HUB_PORT:-4319}/event" \
  -H 'Content-Type: application/json' \
  -d "$payload" >/dev/null 2>&1 &

exit 0
