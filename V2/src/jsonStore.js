/*
 * Peluche Bot V2 — programme personnel de Electro / MathéoCASSY
 * https://github.com/MatheoCASSY/
 *
 * Écriture atomique de fichiers JSON : on écrit dans un fichier temporaire
 * puis on renomme (rename est atomique sur un même volume). Si le process
 * est tué en plein milieu, le fichier final reste soit l'ancienne version
 * soit la nouvelle — jamais un JSON à moitié écrit et corrompu.
 */

import fs from 'fs';
import path from 'path';

export function writeJsonAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
}

export function readJsonSafe(filePath, fallback) {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(raw || '{}');
    }
  } catch (e) { /* fichier corrompu/illisible -> repart du fallback */ }
  return fallback;
}
