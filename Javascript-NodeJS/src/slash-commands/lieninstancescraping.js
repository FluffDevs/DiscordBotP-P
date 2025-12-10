import { SlashCommandBuilder } from 'discord.js';
import logger, { commandInvocation } from '../logger.js';
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

/*
 * Commande /lieninstancescraping
 * Visite la page d'instances d'un groupe VRChat et récupère les "hard links" des instances
 */

const DEFAULT_GROUP = 'grp_497a9988-e19d-43ed-9d46-bb6bfb58a4e2';

export default {
  data: new SlashCommandBuilder()
    .setName('lieninstancescraping')
    .setDescription('Récupère les hard links des instances d\'un groupe VRChat')
    .addStringOption(option =>
      option.setName('group')
        .setDescription('ID du groupe (ex: grp_...) ou URL complète')
        .setRequired(false)),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const input = interaction.options.getString('group') ?? DEFAULT_GROUP;
    // normalize to group id or keep url
    let targetUrl;
    if (input.startsWith('http')) {
      targetUrl = input;
    } else if (input.startsWith('grp_')) {
      targetUrl = `https://vrchat.com/home/group/${input}/instances`;
    } else {
      // try to accept plain id without prefix
      targetUrl = `https://vrchat.com/home/group/${input}/instances`;
    }

  // log invocation using the named export to avoid calling a missing method on default logger
  commandInvocation({ commandName: 'lieninstancescraping', userTag: interaction.user.tag, userId: interaction.user.id });

    let browser;
    try {
      // Launch headless browser; set a common userAgent to reduce bot detection
      browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
      const page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      // Capture network responses (XHR/Fetch) so we can inspect JSON payloads that may contain instances
      const networkResponses = [];
      page.on('response', async (response) => {
        try {
          const url = response.url();
          const status = response.status();
          const headers = response.headers();
          const ct = headers['content-type'] || '';

          // Only bother reading bodies for likely API calls or JSON
          const shouldReadBody = /\/api\/|instances|world|instance|application\/json/i.test(url) || /application\/json/i.test(ct);
          let body = null;
          if (shouldReadBody) {
            try {
              body = await response.text();
            } catch (e) {
              body = null;
            }
          }

          networkResponses.push({ url, status, headers, bodySnippet: body ? body.slice(0, 20000) : null });
        } catch (e) {
          // ignore per-response errors
        }
      });

      await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 30000 });

      // Evaluate the DOM and gather candidate links using broader heuristics.
      // Strategy: look at anchors, buttons, onclick attributes, data- attributes,
      // and any attribute/value containing 'vrchat://' 'launch' 'instance' or 'world'.
      const links = await page.evaluate(() => {
        const out = new Set();

        function addCandidate(raw) {
          if (!raw) return;
          try {
            const url = new URL(raw, window.location.href).href;
            out.add(url);
          } catch (e) {
            out.add(raw);
          }
        }

        // anchors and buttons
        const anchors = Array.from(document.querySelectorAll('a[href]'));
        for (const a of anchors) {
          const href = a.getAttribute('href');
          if (!href) continue;
          if (/vrchat:\/\//i.test(href) || /launch/i.test(href) || /instance/i.test(href) || /\/home\/(launch|world)/i.test(href) || /worldId=|instanceId=/i.test(href)) {
            addCandidate(href);
          }
        }

        const buttons = Array.from(document.querySelectorAll('button, input[type="button"], [role="button"]'));
        for (const b of buttons) {
          // check data-clipboard-text, data-uri, value, onclick
          const attrs = ['data-clipboard-text', 'data-uri', 'data-player-instance', 'data-instance', 'value', 'onclick'];
          for (const a of attrs) {
            const v = b.getAttribute && b.getAttribute(a);
            if (v && (/vrchat:\/\//i.test(v) || /launch/i.test(v) || /instance/i.test(v) || /world/i.test(v))) addCandidate(v);
          }
        }

        // scan all elements' attributes for relevant patterns
        const all = Array.from(document.querySelectorAll('*'));
        for (const el of all) {
          if (!el.attributes) continue;
          for (const at of el.attributes) {
            const val = at.value;
            if (!val || typeof val !== 'string') continue;
            if (/vrchat:\/\//i.test(val) || /launch/i.test(val) || /instance/i.test(val) || /world/i.test(val) || /worldId=|instanceId=/i.test(val)) {
              addCandidate(val);
            }
          }
          // also search innerText for raw vrchat:// URIs
          if (el.innerText && /vrchat:\/\//i.test(el.innerText)) {
            const m = el.innerText.match(/vrchat:\/\/\S+/i);
            if (m) addCandidate(m[0]);
          }
        }

        return Array.from(out);
      });

      // Parse captured network responses to find instance objects / JSON payloads
      const instances = [];

      function tryParseJson(text) {
        if (!text || typeof text !== 'string') return null;
        const t = text.trim();
        if (!(t.startsWith('{') || t.startsWith('['))) return null;
        try {
          return JSON.parse(t);
        } catch (e) {
          return null;
        }
      }

      function collectInstancesFromObject(obj) {
        if (!obj || typeof obj !== 'object') return;

        // If object looks like an instance
        const hasInstanceId = obj.instanceId || obj.instance || obj.id && /:/i.test(String(obj.id));
        const hasWorld = obj.worldId || obj.world || (obj.id && /wrld_/i.test(String(obj.id)));
        if (hasInstanceId || hasWorld) {
          // normalize
          let worldId = null;
          let instanceId = null;
          if (obj.worldId) worldId = obj.worldId;
          if (obj.world && typeof obj.world === 'string') worldId = obj.world;
          if (obj.instanceId) instanceId = obj.instanceId;
          if (obj.instance && typeof obj.instance === 'string') instanceId = obj.instance;
          if (!instanceId && obj.id && typeof obj.id === 'string') {
            // sometimes id contains world:instance
            const s = obj.id;
            if (s.includes(':')) {
              const parts = s.split(':');
              if (parts.length >= 2) {
                if (!worldId) worldId = parts[0];
                instanceId = parts.slice(1).join(':');
              }
            } else {
              instanceId = s;
            }
          }

          // fallback: look for nested fields
          if (!worldId && obj.meta && obj.meta.worldId) worldId = obj.meta.worldId;
          if (!instanceId && obj.meta && obj.meta.instanceId) instanceId = obj.meta.instanceId;

          // try to build an instance signature
          if (worldId && instanceId) {
            instances.push({ worldId: String(worldId), instanceId: String(instanceId), name: obj.name || obj.label || null, users: obj.users || obj.userCount || obj.participants || null, raw: obj });
            return;
          }
        }

        // Recurse arrays and objects
        for (const k in obj) {
          if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
          const v = obj[k];
          if (Array.isArray(v)) {
            for (const item of v) collectInstancesFromObject(item);
          } else if (v && typeof v === 'object') {
            collectInstancesFromObject(v);
          }
        }
      }

      for (const r of networkResponses) {
        if (!r || !r.bodySnippet) continue;
        const parsed = tryParseJson(r.bodySnippet);
        if (parsed) {
          if (Array.isArray(parsed)) {
            for (const item of parsed) collectInstancesFromObject(item);
          } else {
            collectInstancesFromObject(parsed);
          }
        }
      }

      // Also try to recover instances from DOM-collected links if they look like instance URIs
      for (const l of links) {
        try {
          if (typeof l !== 'string') continue;
          // skip group links
          if (/\/home\/group|\/group\//i.test(l)) continue;
          // check for vrchat launch id like wrld_...:...
          const m = l.match(/(wrld_[a-z0-9_-]+:[^"'\s]+)/i);
          if (m) {
            const parts = m[1].split(':');
            const worldId = parts[0];
            const instanceId = parts.slice(1).join(':');
            instances.push({ worldId, instanceId, name: null, users: null, raw: l });
          }
          // or url params
          const u = new URL(l, targetUrl);
          const w = u.searchParams.get('worldId');
          const i = u.searchParams.get('instanceId');
          if (w && i) instances.push({ worldId: w, instanceId: i, name: null, users: null, raw: l });
        } catch (e) {
          // ignore
        }
      }

      // Deduplicate by signature (world:instance)
      const uniq = new Map();
      for (const it of instances) {
        if (!it || !it.worldId || !it.instanceId) continue;
        const sig = `${it.worldId}:${it.instanceId}`;
        if (!uniq.has(sig)) uniq.set(sig, it);
      }
      const foundInstances = Array.from(uniq.values());

      // Save snapshot for debugging (HTML + screenshot) so you can inspect what was loaded
      try {
        const LOG_DIR = path.join(process.cwd(), 'logs');
        try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch (e) {}
        const ts = Date.now();
        const html = await page.content();
        try { fs.writeFileSync(path.join(LOG_DIR, `lieninstances_${ts}.html`), html, 'utf8'); } catch (e) {}
        try { await page.screenshot({ path: path.join(LOG_DIR, `lieninstances_${ts}.png`), fullPage: true }); } catch (e) {}
        // dump captured network responses for inspection
        try { fs.writeFileSync(path.join(LOG_DIR, `lieninstances_network_${ts}.json`), JSON.stringify(networkResponses, null, 2), 'utf8'); } catch (e) {}
      } catch (e) {
        // ignore filesystem errors
      }

      await browser.close();
      if (!foundInstances || foundInstances.length === 0) {
        await interaction.editReply({ content: `Aucune instance trouvée (hard link) sur la page ${targetUrl}. Vérifiez les logs dans /logs pour le snapshot et les réponses réseau.` });
        return;
      }

      // Build a reply listing found instances with constructed hard links
      const maxLen = 1900;
      let text = `Instances trouvées (${foundInstances.length}) pour ${targetUrl}:\n`;
      for (const it of foundInstances) {
        const worldId = it.worldId;
        const instanceId = it.instanceId;
        const name = it.name ? ` - ${it.name}` : '';
        const users = it.users != null ? ` (${it.users} joueurs)` : '';
        // Construct vrchat:// hard link and web alternative
        const vrlink = `vrchat://launch?id=${worldId}:${instanceId}`;
        const webLink = `https://vrchat.com/home/launch?worldId=${encodeURIComponent(worldId)}&instanceId=${encodeURIComponent(instanceId)}`;
        const line = `\n• ${worldId}:${instanceId}${name}${users}\n  ${vrlink}\n  ${webLink}\n`;
        if (text.length + line.length > maxLen) {
          text += `\n...et ${foundInstances.length - text.split('\n').length + 1} instances supplémentaires.`;
          break;
        }
        text += line;
      }

      await interaction.editReply({ content: text });
    } catch (err) {
      logger.error(['Erreur dans /lieninstancescraping:', err]);
      if (browser) try { await browser.close(); } catch (e) { /* ignore */ }
      await interaction.editReply({ content: `Erreur lors du scraping: ${err && err.message ? err.message : String(err)}` });
    }
  }
};
