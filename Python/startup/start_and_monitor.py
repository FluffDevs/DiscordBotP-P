"""Start-and-monitor équivalent en Python.

Surveille un processus (le bot Python) et le redémarre en cas de crash.
Version Windows-friendly (utilise subprocess, restart backoff).

Usage: python Python/startup/start_and_monitor.py --cmd "python Python/bot.py"
"""
import argparse
import subprocess
import time
import sys
import shlex

parser = argparse.ArgumentParser(description='Start and monitor a command (restart on exit)')
parser.add_argument('--cmd', required=True, help='Commande à exécuter (entre guillemets si besoin)')
parser.add_argument('--max-retries', type=int, default=0, help='Nombre max de restart (0 = infini)')
parser.add_argument('--backoff', type=float, default=2.0, help='Temps d\'attente initial entre relances en secondes')
args = parser.parse_args()

cmd = args.cmd
max_retries = args.max_retries
backoff = args.backoff

attempt = 0
failures = 0

print(f"Start-and-monitor: launching: {cmd}")
while True:
    attempt += 1
    try:
        # On Windows, shell=True permet d'exécuter correctement les commands with quotes
        proc = subprocess.Popen(cmd, shell=True)
        print(f"Process started (pid={proc.pid}), waiting...")
        ret = proc.wait()
        print(f"Process exited with code {ret}")
    except KeyboardInterrupt:
        print('Monitoring interrupted by user')
        try:
            proc.terminate()
        except Exception:
            pass
        sys.exit(0)
    except Exception as e:
        print(f"Erreur lors du lancement du processus: {e}")
        ret = -1

    failures += 1
    if max_retries and failures >= max_retries:
        print(f"Maximum retries {max_retries} atteint, arrêt.")
        break

    sleep_time = backoff * (1 if failures == 1 else min(16, failures))
    print(f"Process crashed; redémarrage dans {sleep_time} secondes (tentative {attempt})...")
    time.sleep(sleep_time)

print('Start-and-monitor terminé')
