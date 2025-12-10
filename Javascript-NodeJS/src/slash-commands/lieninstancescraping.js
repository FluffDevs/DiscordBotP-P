import { SlashCommandBuilder } from 'discord.js';
import logger, { commandInvocation } from '../logger.js';
import puppeteer from 'puppeteer';

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

    logger.commandInvocation({ commandName: 'lieninstancescraping', userTag: interaction.user.tag, userId: interaction.user.id });

    let browser;
    try {
      // Launch headless browser; set a common userAgent to reduce bot detection
      browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
      const page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 30000 });

      // Evaluate the DOM and gather candidate links.
      // Strategy: collect anchors with hrefs that look like vrchat launch links or include '/instance/' or 'launch'
      const links = await page.evaluate(() => {
        const out = new Set();
        const anchors = Array.from(document.querySelectorAll('a[href]'));
        for (const a of anchors) {
          const href = a.getAttribute('href');
          if (!href) continue;
          // Accept absolute URLs and vrchat:// links and relative links containing launch/instance
          if (/^vrchat:\/\//i.test(href) || /launch/i.test(href) || /instance/i.test(href) || href.includes('/home/launch') || href.includes('/home/world')) {
            // Resolve relative urls
            try {
              const url = new URL(href, window.location.href).href;
              out.add(url);
            } catch (e) {
              out.add(href);
            }
          }
        }
        // Also check data attributes that may contain launch URIs
        const divs = Array.from(document.querySelectorAll('[data-uri], [data-player-instance], [data-instance]'));
        for (const d of divs) {
          for (const attr of ['data-uri', 'data-player-instance', 'data-instance']) {
            const v = d.getAttribute(attr);
            if (v) {
              try { out.add(new URL(v, window.location.href).href); } catch (e) { out.add(v); }
            }
          }
        }
        return Array.from(out);
      });

      await browser.close();
      if (!links || links.length === 0) {
        await interaction.editReply({ content: `Aucun hard link trouvé sur la page ${targetUrl}.` });
        return;
      }

      // Build a reply: join links, but respect Discord message length limits (2000 chars). If too long, send first N and indicate.
      const maxLen = 1900;
      let text = `Liens trouvés (${links.length}) pour ${targetUrl}:\n`;
      for (const l of links) {
        if (text.length + l.length + 2 > maxLen) {
          text += `\n...et ${links.length - text.split('\n').length + 1} liens supplémentaires.`;
          break;
        }
        text += `\n${l}`;
      }

      await interaction.editReply({ content: text });
    } catch (err) {
      logger.error(['Erreur dans /lieninstancescraping:', err]);
      if (browser) try { await browser.close(); } catch (e) { /* ignore */ }
      await interaction.editReply({ content: `Erreur lors du scraping: ${err && err.message ? err.message : String(err)}` });
    }
  }
};
