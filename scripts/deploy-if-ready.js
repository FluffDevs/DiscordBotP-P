import dotenv from 'dotenv';
dotenv.config();

import { spawnSync } from 'child_process';

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;

const missing = [];
if (!token) missing.push('DISCORD_TOKEN');
if (!clientId) missing.push('CLIENT_ID');

if (missing.length) {
  console.error('Variables manquantes dans .env:', missing.join(', '));
  console.error('Copiez `.env.example` vers `.env` et remplissez les valeurs, puis relancez `npm run deploy-if-ready`.');
  process.exit(1);
}

console.log('Variables requises présentes — démarrage du déploiement des slash-commands...');
const res = spawnSync(process.execPath, ['src/deploy-commands.js'], { stdio: 'inherit' });
process.exit(res.status ?? 0);
