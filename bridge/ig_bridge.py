"""
Instagram DM Bridge — dumb messenger service.

DOES:
  1. Polls inbox for new image DMs (every 30s)
  2. Downloads the image
  3. POSTs image to ghost-cart /api/search-image
  4. Sends back whatever ghost-cart returns as a DM reply

DOES NOT:
  - Any analysis, formatting, search, or decisions
"""
import json
import logging
import os
import sys
import time
from pathlib import Path

import httpx
from instagrapi import Client

# ── Config ──────────────────────────────────────────────
CONFIG_PATH = Path(os.path.expanduser("~/.config/stylefinder/config.json"))
SESSION_PATH = Path(os.path.expanduser("~/.config/stylefinder/session.json"))
MEDIA_DIR = Path("media/incoming")
MEDIA_DIR.mkdir(parents=True, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("ig-bridge")

if not CONFIG_PATH.exists():
    log.error("Config not found: %s", CONFIG_PATH)
    sys.exit(1)

cfg = json.loads(CONFIG_PATH.read_text())
USERNAME = cfg["instagram"]["username"]
PASSWORD = cfg["instagram"]["password"]
POLL_INTERVAL = cfg.get("poll_interval", 30)
GHOSTCART_URL = cfg.get("ghostcart_url", "http://localhost:3000")
PROXY = cfg.get("proxy")

cl = Client()
cl.delay_range = [1, 3]
if PROXY:
    cl.set_proxy(PROXY)

seen_messages: set[str] = set()


# ── Auth ────────────────────────────────────────────────
def login():
    if SESSION_PATH.exists():
        log.info("Restoring session...")
        try:
            cl.set_settings(json.loads(SESSION_PATH.read_text()))
            cl.login(USERNAME, PASSWORD)
            cl.get_timeline_feed()
            log.info("Session restored ✅")
            return
        except Exception as e:
            log.warning("Session restore failed: %s — fresh login", e)
            cl.__init__()
            cl.delay_range = [1, 3]
            if PROXY:
                cl.set_proxy(PROXY)
    log.info("Fresh login as @%s...", USERNAME)
    cl.login(USERNAME, PASSWORD)
    save_session()
    log.info("Logged in ✅ (user_id: %s)", cl.user_id)


def save_session():
    SESSION_PATH.parent.mkdir(parents=True, exist_ok=True)
    SESSION_PATH.write_text(json.dumps(cl.get_settings(), indent=2, default=str))


# ── DM helpers ──────────────────────────────────────────
def send_dm(thread_id: str, text: str):
    try:
        cl.direct_answer(int(thread_id), text)
        log.info("📤 Reply sent to thread %s", thread_id)
    except Exception as e:
        log.error("Failed to send DM to %s: %s", thread_id, e)


def download_url(url: str, filename: str) -> str | None:
    try:
        filepath = MEDIA_DIR / filename
        r = httpx.get(url, timeout=30, follow_redirects=True)
        if r.status_code == 200 and len(r.content) > 1000:
            filepath.write_bytes(r.content)
            return str(filepath)
    except Exception as e:
        log.error("Download failed for %s: %s", filename, e)
    return None


def extract_image_from_item(item: dict) -> tuple[str | None, dict]:
    """Extract image URL and metadata from a DM item. Returns (image_path, metadata)."""
    item_type = item.get("item_type", "")
    item_id = str(item.get("item_id", ""))
    metadata = {"item_type": item_type}

    # Shared IG post (most common for our use case)
    if item_type == "xma_media_share":
        xma_list = item.get("xma_media_share", [])
        if xma_list:
            xma = xma_list[0]
            preview_url = xma.get("preview_url")
            metadata["post_url"] = xma.get("target_url", "")
            metadata["post_author"] = xma.get("header_title_text", "")
            metadata["caption"] = (xma.get("title_text") or "")[:200]
            if preview_url:
                path = download_url(preview_url, f"{item_id}_xma.jpg")
                return path, metadata

    # Direct photo/video DM
    if item_type == "media":
        media = item.get("media", {})
        candidates = media.get("image_versions2", {}).get("candidates", [])
        if candidates:
            url = candidates[0].get("url")
            if url:
                path = download_url(url, f"{item_id}_media.jpg")
                return path, metadata

    # Shared post (older format)
    if item_type == "media_share":
        share = item.get("media_share", {})
        candidates = share.get("image_versions2", {}).get("candidates", [])
        caption = share.get("caption", {})
        if isinstance(caption, dict):
            metadata["caption"] = caption.get("text", "")[:200]
        if candidates:
            url = candidates[0].get("url")
            if url:
                path = download_url(url, f"{item_id}_share.jpg")
                return path, metadata

    # Reel share
    if item_type == "clip":
        clip = item.get("clip", {}).get("clip", {})
        candidates = clip.get("image_versions2", {}).get("candidates", [])
        if candidates:
            url = candidates[0].get("url")
            if url:
                path = download_url(url, f"{item_id}_clip.jpg")
                return path, metadata

    return None, metadata


# ── Ghost-cart call ─────────────────────────────────────
def call_ghostcart(image_path: str, username: str, thread_id: str, metadata: dict) -> dict | None:
    url = f"{GHOSTCART_URL}/api/search-image"
    try:
        with open(image_path, "rb") as f:
            response = httpx.post(
                url,
                files={"image": (os.path.basename(image_path), f, "image/jpeg")},
                data={
                    "username": username,
                    "thread_id": thread_id,
                    "post_url": metadata.get("post_url", ""),
                    "post_author": metadata.get("post_author", ""),
                    "caption": metadata.get("caption", ""),
                },
                timeout=120,
            )
        if response.status_code == 200:
            return response.json()
        else:
            log.error("Ghost-cart %s: %s", response.status_code, response.text[:200])
            return None
    except httpx.ConnectError:
        log.error("Ghost-cart not reachable at %s", GHOSTCART_URL)
        return None
    except Exception as e:
        log.error("Ghost-cart call failed: %s", e)
        return None


# ── Thread processing (raw API) ─────────────────────────
def process_raw_items(thread_id: str, items: list, thread_title: str):
    """Process items from any inbox (regular, pending, spam)."""
    for item in items:
        msg_id = str(item.get("item_id", ""))
        if msg_id in seen_messages:
            continue

        user_id = str(item.get("user_id", ""))
        if user_id == str(cl.user_id):
            seen_messages.add(msg_id)
            continue

        seen_messages.add(msg_id)
        item_type = item.get("item_type", "")

        # Try to extract image
        image_path, metadata = extract_image_from_item(item)

        if not image_path:
            if item_type == "text":
                text = item.get("text", "")
                log.info("💬 Text from @%s: %s", thread_title, text[:50])
                send_dm(thread_id, "Hey! Send me a photo of any clothing item and I'll find it for you 🔍")
            else:
                log.info("⏭️ Skipping %s from @%s (no image)", item_type, thread_title)
            continue

        log.info("📸 Image from @%s [%s] — downloaded: %s", thread_title, item_type, image_path)

        # Acknowledge
        send_dm(thread_id, "Got it! Analyzing your image... 🔍 This might take a moment.")

        # Call ghost-cart
        log.info("🔄 Calling ghost-cart...")
        result = call_ghostcart(image_path, thread_title, thread_id, metadata)

        if result and result.get("dm_text"):
            send_dm(thread_id, result["dm_text"])
            log.info("✅ Results sent to @%s", thread_title)
        else:
            send_dm(thread_id, "Sorry, I couldn't find results for that image. Try a clearer photo? 🙏")
            log.warning("❌ No results for @%s", thread_title)


def get_raw_threads(endpoint: str) -> list:
    """Fetch threads from a raw API endpoint."""
    try:
        result = cl.private_request(endpoint, params={"limit": "20"})
        return result.get("inbox", {}).get("threads", [])
    except Exception as e:
        log.warning("Failed to fetch %s: %s", endpoint, e)
        return []


# ── Main loop ───────────────────────────────────────────
def poll_loop():
    log.info("🚀 Bridge started. Polling every %ds. Ghost-cart: %s", POLL_INTERVAL, GHOSTCART_URL)

    while True:
        try:
            # 1. Check spam inbox (where first-time non-follower DMs land)
            spam_threads = get_raw_threads("direct_v2/spam_inbox/")
            for t in spam_threads:
                tid = t.get("thread_id", "")
                name = t.get("thread_title", "Unknown")
                items = t.get("items", [])
                # Approve so future messages go to regular inbox
                try:
                    cl.private_request(
                        f"direct_v2/threads/{tid}/approve/",
                        data={"_uuid": cl.uuid, "_uid": cl.user_id},
                    )
                    log.info("✅ Approved spam request from @%s", name)
                except Exception:
                    pass
                process_raw_items(tid, items, name)

            # 2. Check pending inbox
            try:
                pending = cl.direct_pending_inbox(amount=20)
                for thread in pending:
                    try:
                        cl.direct_pending_approve(int(thread.id))
                    except Exception:
                        pass
            except Exception:
                pass

            # 3. Check regular inbox (unread)
            inbox_threads = get_raw_threads("direct_v2/inbox/")
            for t in inbox_threads:
                tid = t.get("thread_id", "")
                name = t.get("thread_title", "Unknown")
                items = t.get("items", [])
                process_raw_items(tid, items, name)

            save_session()

        except Exception as e:
            log.error("Poll error: %s", e)
            time.sleep(POLL_INTERVAL * 2)
            continue

        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    login()
    try:
        poll_loop()
    except KeyboardInterrupt:
        log.info("👋 Shutting down")
        save_session()
