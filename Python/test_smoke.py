"""Test de fumée : importe les modules et instancie les classes principales."""
from logger import Logger
from telegram_bridge import get_bridge
from verification import VerificationManager


def run():
    l = Logger()
    l.info('Logger initialisé (smoke test)')
    tb = get_bridge()
    tb.enqueue_log('Test queue log')
    print('Telegram queue length:', len(tb.get_queue()))
    # create a dummy client-like object for verification manager smoke test
    class DummyClient:
        async def fetch_channel(self, id):
            raise Exception('no network')

    vm = VerificationManager(DummyClient(), l, tb)
    print('VerificationManager store keys:', list(vm.store.keys()))


if __name__ == '__main__':
    run()
