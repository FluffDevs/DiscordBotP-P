"""Pont Telegram léger qui appelle l'API HTTP de Telegram.

Fonctionnalités principales:
- queue persistée sur disque
- flush périodique (background thread)
- split des messages trop longs
- envoi uniquement si TELEGRAM_ENABLED=true et TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID fournis
"""
import os
import json
import threading
import time
from pathlib import Path
from typing import List
import urllib.request
import urllib.error

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / 'data'
DATA_DIR.mkdir(parents=True, exist_ok=True)
QUEUE_FILE = DATA_DIR / 'telegram-queue.json'


class TelegramBridge:
    def __init__(self):
        self._queue: List[str] = []
        self._lock = threading.Lock()
        self._load()
        self._flush_interval = int(os.getenv('TELEGRAM_BATCH_INTERVAL_SEC', '15'))
        self._max_message_size = int(os.getenv('TELEGRAM_MAX_MESSAGE_SIZE', '3800'))
        self._token = os.getenv('TELEGRAM_BOT_TOKEN')
        self._chat_id = os.getenv('TELEGRAM_CHAT_ID')
        self._enabled = (os.getenv('TELEGRAM_ENABLED', '').lower() == 'true')
        self._stop = False
        self._thread = threading.Thread(target=self._periodic_flush, daemon=True)
        self._thread.start()

    def _load(self):
        try:
            if QUEUE_FILE.exists():
                raw = QUEUE_FILE.read_text(encoding='utf8')
                parsed = json.loads(raw or '[]')
                if isinstance(parsed, list):
                    self._queue = [str(x) for x in parsed]
        except Exception:
            self._queue = []

    def _persist(self):
        try:
            tmp = str(QUEUE_FILE) + '.tmp'
            with open(tmp, 'w', encoding='utf8') as fh:
                json.dump(self._queue, fh, indent=2, ensure_ascii=False)
            os.replace(tmp, QUEUE_FILE)
        except Exception:
            pass

    def enqueue_log(self, text: str) -> bool:
        if not text:
            return False
        with self._lock:
            self._queue.append(str(text))
            self._persist()
        return True

    def enqueue_verification(self, text: str) -> bool:
        return self.enqueue_log(text)

    def send_immediate(self, text: str, parse_mode: str = 'HTML') -> bool:
        """Send a message immediately (synchronous). Returns True on success."""
        if not self._enabled or not self._token or not self._chat_id:
            return False
        try:
            chunks = self._split_chunks(text)
            for c in chunks:
                self._http_send({'chat_id': self._chat_id, 'text': c, 'parse_mode': parse_mode})
                time.sleep(0.25)
            return True
        except Exception:
            return False

    def get_queue(self) -> List[str]:
        with self._lock:
            return list(self._queue)

    def _split_chunks(self, text: str) -> List[str]:
        if not text:
            return []
        max_size = max(1000, int(self._max_message_size))
        chunks = []
        remaining = text
        while remaining:
            if len(remaining) <= max_size:
                chunks.append(remaining)
                break
            # try to cut at last newline
            cut = remaining.rfind('\n', 0, max_size)
            if cut < int(max_size * 0.6):
                cut = max_size
            chunks.append(remaining[:cut])
            remaining = remaining[cut:]
        return chunks

    def _http_send(self, payload: dict):
        if not self._token:
            raise RuntimeError('Telegram token not configured')
        url = f'https://api.telegram.org/bot{self._token}/sendMessage'
        data = json.dumps(payload).encode('utf8')
        req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            # basic check
            raw = resp.read(200)
            return raw

    def _flush(self):
        if not self._enabled or not self._token or not self._chat_id:
            # nothing to do, but keep queue persisted
            self._persist()
            return
        with self._lock:
            if not self._queue:
                return
            joined = '\n\n---\n\n'.join(self._queue)
            chunks = self._split_chunks(joined)
        try:
            for c in chunks:
                self._http_send({'chat_id': self._chat_id, 'text': c})
                time.sleep(0.3)
            # clear queue on success
            with self._lock:
                self._queue.clear()
                self._persist()
        except Exception:
            # keep queue and persist
            self._persist()

    def _periodic_flush(self):
        while not self._stop:
            try:
                self._flush()
            except Exception:
                pass
            time.sleep(max(1, int(self._flush_interval)))

    def stop(self):
        self._stop = True
        try:
            self._thread.join(timeout=2)
        except Exception:
            pass


_singleton = None


def _get_singleton() -> TelegramBridge:
    global _singleton
    if _singleton is None:
        _singleton = TelegramBridge()
    return _singleton


def get_bridge() -> TelegramBridge:
    return _get_singleton()


__all__ = ['TelegramBridge', 'get_bridge']
