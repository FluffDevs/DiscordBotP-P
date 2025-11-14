import assert from 'assert';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pingPath = pathToFileURL(path.join(__dirname, '../src/commands/ping.js')).href;
const mod = await import(pingPath);
const ping = mod.default ?? mod;

assert.strictEqual(ping.name, 'ping');
assert.strictEqual(typeof ping.execute, 'function');

console.log('OK — ping command shape is valid');
