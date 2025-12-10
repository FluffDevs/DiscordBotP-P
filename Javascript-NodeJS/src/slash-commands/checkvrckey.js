import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';

// Convert the original CLI diagnostic into a slash command that runs the same checks
// and returns the output to the user (inline or as a file when long).

const groupEnv = process.env.VRCHAT_GROUP_ID_FLUFFRADIO || process.env.VRCHAT_GROUP_ID || 'grp_497a9988-e19d-43ed-9d46-bb6bfb58a4e2';
const DEFAULT_VRCHAT_API_KEY = 'Zmx1ZmZyYWRpbzpfLmpkaktzPS41Z0tYcXg=';
const apiKey = process.env.VRCHAT_API_KEY || (process.env.VRCHAT_USE_DEFAULT_API_KEY === '1' ? DEFAULT_VRCHAT_API_KEY : 'auth=authcookie_30be6bb2-89b5-4ca5-af61-5f97818baaf1');
const userAgent = process.env.VRCHAT_USER_AGENT || 'PelucheBot/1.0 (FluffDevs; https://github.com/FluffDevs/DiscordBotP-P)';

function masked(s) {
  if (!s) return 'none';
  const st = String(s);
  return st.length <= 6 ? st + '...' : st.slice(0,6) + '...';
}

function makeLogger() {
  const lines = [];
  return {
    log: (...parts) => { lines.push(parts.join(' ')); },
    error: (...parts) => { lines.push('ERROR: ' + parts.join(' ')); },
    getOutput: () => lines.join('\n')
  };
}

export default {
  data: new SlashCommandBuilder()
    .setName('cherckvrckey')
    .setDescription("Exécute une vérification de la clé VRChat et renvoie la sortie (alias `/cherckvrckey`)")
    .addStringOption(opt => opt.setName('group').setDescription('URL du groupe ou ID (ex: https://vrchat.com/home/group/grp_xxx or grp_xxx)')),

  async execute(interaction) {
    // Restrict usage to bot owner or server administrators by default for safety
    const ownerId = process.env.OWNER_ID;
    const isOwner = ownerId && interaction.user.id === ownerId;
    const hasAdmin = interaction.member?.permissions?.has(PermissionFlagsBits.Administrator);
    if (ownerId && !isOwner && !hasAdmin) {
      return interaction.reply({ content: 'Vous n\'êtes pas autorisé à utiliser cette commande.', ephemeral: true });
    }

    await interaction.deferReply();
    const logger = makeLogger();

    logger.log('VRChat key diagnostic');
    // allow overriding group via command option (URL or grp_ id)
    const providedGroup = interaction.options.getString('group');
    let groupToUse = groupEnv;
    if (providedGroup) {
      // try to extract grp_... id from provided string
      const m = providedGroup.match(/(grp_[0-9a-fA-F-]+)/i);
      if (m) groupToUse = m[1];
      else {
        // fallback: if the user provided a plain id-like string, accept it
        if (/^grp_[0-9a-fA-F-]+$/.test(providedGroup)) groupToUse = providedGroup;
      }
      logger.log('Using provided group option, parsed group:', groupToUse);
    }
    logger.log('Group:', groupToUse);
    const authCookie = process.env.VRCHAT_AUTH_COOKIE || null;
    logger.log('API key present:', !!apiKey, 'masked=', masked(apiKey));
    logger.log('Auth cookie present:', !!authCookie);

    if (!apiKey && !authCookie) {
      logger.error('No VRCHAT_API_KEY or VRCHAT_AUTH_COOKIE in environment. Set VRCHAT_API_KEY or VRCHAT_AUTH_COOKIE and retry.');
      const out = logger.getOutput();
      // small output -> reply inline
      return interaction.editReply({ content: '```\n' + out + '\n```' });
    }

  const url = `https://api.vrchat.cloud/api/1/groups/${encodeURIComponent(groupToUse)}/instances`;
    const headers = {
      'Accept': 'application/json',
      'User-Agent': userAgent
    };
    if (apiKey) headers['X-API-Key'] = apiKey;
    else if (authCookie) headers['Cookie'] = authCookie;

    logger.log('Calling', url);
    // We'll try once, then on 401 attempt a small set of fallbacks (base64-decoded key, cookie)
    let triedDecoded = false;
    let triedCookie = false;
    async function doFetch(withHeaders) {
      const r = await fetch(url, { method: 'GET', headers: withHeaders });
      const s = r.status;
      let bt = '';
      try { bt = await r.text(); } catch (e) { bt = '<unable to read body>'; }
      return { res: r, status: s, bodyText: bt };
    }

    try {
      let attemptHeaders = { ...headers };
      let result = await doFetch(attemptHeaders);
      logger.log('HTTP', result.status);
      try {
        const json = JSON.parse(result.bodyText);
        logger.log('Body (json):', JSON.stringify(json, null, 2));
      } catch (e) {
        logger.log('Body (text):', result.bodyText);
      }

      if (result.status === 200) {
        logger.log('Success: API key works for group instances.');
      } else if (result.status === 401) {
        logger.log('Unauthorized: API reports missing/invalid credentials.');
        // First fallback: if apiKey looks base64-y, try decode and retry once
        if (apiKey && !triedDecoded) {
          triedDecoded = true;
          try {
            const decoded = Buffer.from(apiKey, 'base64').toString('utf8');
            if (decoded && decoded !== apiKey) {
              logger.log('Attempting retry with base64-decoded API key (masked):', masked(decoded));
              const h2 = { ...headers, 'X-API-Key': decoded };
              const r2 = await doFetch(h2);
              logger.log('HTTP (retry decoded)', r2.status);
              try { const j2 = JSON.parse(r2.bodyText); logger.log('Body (json):', JSON.stringify(j2, null, 2)); } catch (e) { logger.log('Body (text):', r2.bodyText); }
              if (r2.status === 200) { logger.log('Success with decoded API key.'); result = r2; }
            }
          } catch (e) {
            logger.log('Base64 decode retry skipped (invalid base64)');
          }
        }

        // Second fallback: if authCookie exists and we haven't tried it, try with cookie
        if (authCookie && !triedCookie && result.status !== 200) {
          triedCookie = true;
          logger.log('Attempting retry with auth cookie.');
          const h3 = { 'Accept': 'application/json', 'User-Agent': userAgent, 'Cookie': authCookie };
          const r3 = await doFetch(h3);
          logger.log('HTTP (retry cookie)', r3.status);
          try { const j3 = JSON.parse(r3.bodyText); logger.log('Body (json):', JSON.stringify(j3, null, 2)); } catch (e) { logger.log('Body (text):', r3.bodyText); }
          if (r3.status === 200) { logger.log('Success with auth cookie.'); result = r3; }
        }

        if (result.status === 200) {
          // already logged
        } else if (result.status === 401) {
          logger.log('Still unauthorized after retries.');
          logger.log('Conseil: vérifiez que VRCHAT_API_KEY ou VRCHAT_AUTH_COOKIE est correct(e). Vous pouvez aussi fournir l\'URL du groupe en option `group` pour tester un autre groupe.');
        }
      } else if (result.status === 403) {
        logger.log('Forbidden: check User-Agent or key permissions.');
      } else {
        logger.log('Unexpected status code:', result.status);
      }
    } catch (err) {
      logger.error('Fetch failed:', err && err.message ? err.message : String(err));
    }

    const out = logger.getOutput();
    // If small, send inline code block, otherwise attach as file
    if (out.length <= 1800) {
      return interaction.editReply({ content: '```\n' + out + '\n```' });
    }

    try {
      const buffer = Buffer.from(out, 'utf8');
      return interaction.editReply({ content: 'Résultat trop long : voir la pièce jointe.', files: [{ attachment: buffer, name: 'checkvrckey-output.txt' }] });
    } catch (e) {
      // Fallback to truncation
      const short = out.slice(0, 1900);
      return interaction.editReply({ content: '```\n' + short + '\n... (trunc)\n```' });
    }
  }
};
