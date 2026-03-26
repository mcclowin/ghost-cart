"""
Test: Poll inbox once, and if there's an unread DM, reply to it.
No ghost-cart needed — just proves the DM pipe works.

Run: python3 bridge/test_dm_roundtrip.py
"""
import json
import os
import sys
import time
from pathlib import Path
from instagrapi import Client

CONFIG_PATH = Path(os.path.expanduser("~/.config/stylefinder/config.json"))
SESSION_PATH = Path(os.path.expanduser("~/.config/stylefinder/session.json"))

cfg = json.loads(CONFIG_PATH.read_text())
USERNAME = cfg["instagram"]["username"]
PASSWORD = cfg["instagram"]["password"]

cl = Client()
cl.delay_range = [1, 3]

# Restore session
if SESSION_PATH.exists():
    print("📂 Restoring session...")
    cl.set_settings(json.loads(SESSION_PATH.read_text()))
    cl.login(USERNAME, PASSWORD)
else:
    print("🔑 Fresh login...")
    cl.login(USERNAME, PASSWORD)

print(f"✅ Logged in as @{USERNAME} (user_id: {cl.user_id})")

# Poll for unread
print("\n📥 Checking for unread DMs...")
threads = cl.direct_threads(amount=10, selected_filter="unread")

if not threads:
    print("No unread DMs. Send a message to @elephant.8846128 from another account and run again!")
    # Also check all threads
    all_threads = cl.direct_threads(amount=5)
    if all_threads:
        print(f"\n📬 All recent threads ({len(all_threads)}):")
        for t in all_threads:
            title = t.thread_title or "Unknown"
            last = ""
            if t.messages:
                m = t.messages[0]
                last = m.text[:40] if m.text else f"[{m.item_type}]"
            print(f"  💬 {title} — {last}")
    sys.exit(0)

print(f"Found {len(threads)} unread thread(s)!\n")

for thread in threads:
    title = thread.thread_title or "Unknown"
    print(f"💬 Thread: {title} (id: {thread.id})")

    for msg in thread.messages:
        if str(msg.user_id) == str(cl.user_id):
            continue  # skip our own

        sender = "unknown"
        for user in thread.users:
            if str(user.pk) == str(msg.user_id):
                sender = user.username
                break

        print(f"  📩 From @{sender}: ", end="")

        if msg.item_type == "text":
            print(f'"{msg.text}"')
        elif msg.item_type == "media":
            print("[IMAGE]")
            if msg.media and hasattr(msg.media, 'thumbnail_url') and msg.media.thumbnail_url:
                print(f"     thumbnail: {str(msg.media.thumbnail_url)[:80]}...")
        elif msg.item_type == "media_share":
            print("[SHARED POST]")
        else:
            print(f"[{msg.item_type}]")

    # Send test reply
    reply = f"🤖 Test reply! I'm alive. Time: {time.strftime('%H:%M:%S UTC')}"
    print(f"\n  📤 Sending reply: {reply}")
    try:
        cl.direct_answer(int(thread.id), reply)
        print("  ✅ Reply sent!")
    except Exception as e:
        print(f"  ❌ Failed: {e}")

# Save session
SESSION_PATH.write_text(json.dumps(cl.get_settings(), indent=2, default=str))
print("\n💾 Session saved. DM pipe works! 🎉")
