#!/bin/bash
# Claude Code SessionStart hook (.claude/settings.json): surfaces entries in
# docs/projection-model-log.md -- written by the weekly projection-review
# cloud routine -- that haven't been shown yet, so each session opens with a
# review of what changed in the projection model and why. Reads the log from
# origin/main so a stale local checkout still sees the latest entries.
# Remembers the newest entry shown in .claude/projection-review-seen
# (gitignored).
cd "$(dirname "$0")/.." || exit 0
LOG=docs/projection-model-log.md
SEEN=.claude/projection-review-seen

git fetch -q origin main 2>/dev/null
content=$(git show origin/main:"$LOG" 2>/dev/null || cat "$LOG" 2>/dev/null) || exit 0
[ -z "$content" ] && exit 0

seen=$(cat "$SEEN" 2>/dev/null || echo "0000-00-00")
printf '%s\n' "$content" | python3 -c '
import json, re, sys
seen = sys.argv[1]
entries, cur = [], None
for line in sys.stdin.read().splitlines():
    m = re.match(r"^## (\d{4}-\d{2}-\d{2})", line)
    if m:
        cur = [m.group(1), [line]]
        entries.append(cur)
    elif cur:
        cur[1].append(line)
new = [e for e in entries if e[0] > seen]
if not new:
    sys.exit(0)
body = "\n".join("\n".join(e[1]).strip() for e in new)
open(sys.argv[2], "w").write(max(e[0] for e in new) + "\n")
print(json.dumps({
    "systemMessage": f"{len(new)} new projection-model review(s) since you last looked.",
    "hookSpecificOutput": {
        "hookEventName": "SessionStart",
        "additionalContext": "New entries in docs/projection-model-log.md from the weekly projection-review routine, not yet shown to the user. "
            "At the start of your first reply, give the user a short review of these: what changed in how projections are calculated, "
            "the evidence (walk-forward numbers), and anything that needs their decision. If their local checkout is behind origin/main, mention they should pull.\n\n" + body,
    },
}))
' "$seen" "$SEEN"
