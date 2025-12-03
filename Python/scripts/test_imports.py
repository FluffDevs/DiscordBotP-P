"""Test d'import pour vérifier que les modules clés se chargent en Python.
Imite `scripts/test-imports.js` du repo JS.
"""
import time
import sys
from pathlib import Path
# ensure Python/ package is importable
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
try:
    from telegram_bridge import get_bridge
    tb = get_bridge()
    print('telegram.loaded', callable(getattr(tb, 'get_queue', None)))
    try:
        print('telegram.queueLen', len(tb.get_queue()))
    except Exception as e:
        print('telegram.queueLen', 'ERR', e)
    # check some slash command modules
    try:
        import importlib.util
        from pathlib import Path
        base = Path(__file__).resolve().parent.parent
        sc = base / 'slash_commands' / 'liste.py'
        spec = importlib.util.spec_from_file_location('slash_commands.liste', str(sc))
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        ok = hasattr(mod, 'data') and hasattr(mod, 'execute') or (hasattr(mod, 'name') and hasattr(mod, 'execute'))
        print('liste.loaded', 'ok' if ok else 'bad')
    except Exception as e:
        print('liste.loaded', 'ERR', e)
    try:
        sc2 = base / 'slash_commands' / 'flush_telegram.py'
        spec2 = importlib.util.spec_from_file_location('slash_commands.flush_telegram', str(sc2))
        mod2 = importlib.util.module_from_spec(spec2)
        spec2.loader.exec_module(mod2)
        ok2 = hasattr(mod2, 'data') and hasattr(mod2, 'execute') or (hasattr(mod2, 'name') and hasattr(mod2, 'execute'))
        print('flush.loaded', 'ok' if ok2 else 'bad')
    except Exception as e:
        print('flush.loaded', 'ERR', e)
    # give background threads time to flush then exit
    time.sleep(0.2)
    sys.exit(0)
except Exception as e:
    print('ERR', e)
    sys.exit(1)
