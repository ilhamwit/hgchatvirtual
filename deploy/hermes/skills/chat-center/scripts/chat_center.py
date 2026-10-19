#!/usr/bin/env python3
"""Chat Center (agents.herrygunawan.com) for the HG team's WhatsApp agent:
create an event in Schedule, or list upcoming events (EPIC-013).

Who is asking and in which chat are NOT arguments: they come from the
HERMES_SESSION_* variables the Hermes gateway sets on every command, so the
model cannot pick them. The API key is read from a file (mode 600).

  chat_center.py create --title "Rapat Q4" --date 2026-10-24 --time 10:00 \\
      [--duration 60] [--location "..."] [--attendees "..."] [--notes "..."] --mode draft|send
  chat_center.py list [--days 7]

Prints one JSON object. On success relay its "reply" text; on failure relay "message".
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request

BASE = os.environ.get("CHAT_CENTER_URL", "http://127.0.0.1:8643")
KEY_FILE = os.path.expanduser(os.environ.get("CHAT_CENTER_KEY_FILE", "~/.config/chat-center-agent.key"))


def out(obj, code=0):
    print(json.dumps(obj, ensure_ascii=False))
    sys.exit(code)


def api_key():
    try:
        with open(KEY_FILE, encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        out({"ok": False, "error": "no_key", "message": "API key Chat Center belum dipasang (scripts/install-hermes-skill.sh)."}, 1)


def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method,
                                 headers={"Authorization": "Bearer " + api_key(), "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        try:
            err = json.load(e)
        except Exception:
            err = {"error": "http_%d" % e.code, "message": "Chat Center menolak permintaan (HTTP %d)." % e.code}
        out({"ok": False, **err}, 1)
    except (urllib.error.URLError, TimeoutError) as e:
        out({"ok": False, "error": "unreachable", "message": "Chat Center tidak bisa dihubungi (%s)." % getattr(e, "reason", e)}, 1)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("create", help="buat acara di Schedule")
    c.add_argument("--title", required=True)
    c.add_argument("--date", required=True, help="YYYY-MM-DD (WIB)")
    c.add_argument("--time", required=True, help="HH:MM (WIB, 24 jam)")
    c.add_argument("--duration", type=int, help="menit, default 60")
    c.add_argument("--location")
    c.add_argument("--attendees")
    c.add_argument("--notes")
    c.add_argument("--mode", required=True, choices=["draft", "send"], help="tanyakan dulu ke peminta")
    l = sub.add_parser("list", help="jadwal mendatang")
    l.add_argument("--days", type=int, default=7)
    a = p.parse_args()

    if a.cmd == "list":
        out(call("GET", "/api/v1/events?days=%d" % a.days))

    if os.environ.get("HERMES_SESSION_PLATFORM", "").lower() != "whatsapp":
        out({"ok": False, "error": "not_whatsapp", "message": "Membuat jadwal lewat skill ini hanya bisa dari chat WhatsApp."}, 1)
    body = {
        "title": a.title, "date": a.date, "time": a.time, "mode": a.mode,
        "chatId": os.environ.get("HERMES_SESSION_CHAT_ID", ""),
        "requester": {
            "waId": os.environ.get("HERMES_SESSION_USER_ID", ""),
            "waIdAlt": os.environ.get("HERMES_SESSION_USER_ID_ALT", ""),
            "name": os.environ.get("HERMES_SESSION_USER_NAME", ""),
        },
    }
    for k, v in (("durationMin", a.duration), ("location", a.location), ("attendees", a.attendees), ("notes", a.notes)):
        if v is not None:
            body[k] = v
    out(call("POST", "/api/v1/events", body))


if __name__ == "__main__":
    main()
