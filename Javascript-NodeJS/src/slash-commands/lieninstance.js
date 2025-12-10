import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';

// Valeurs par défaut pour login VRChat (modifiable directement dans le fichier)
// IMPORTANT: Ne jamais committer de vraies identifiants sur un dépôt public.
// Remplacez ces valeurs si vous voulez un fallback sans définir de variables d'environnement.
const DEFAULT_VRCHAT_USERNAME = 'fluffradio';
const DEFAULT_VRCHAT_PASSWORD = '_.jdjKs=.5gKXqx';

// Valeur par défaut de l'API key fournie (fallback si VRCHAT_API_KEY n'est pas défini)
// AVERTISSEMENT: stocker une clé dans le code source est risqué. Ne commitez pas ce fichier
// vers un dépôt public si la clé doit rester privée.
const DEFAULT_VRCHAT_API_KEY = 'Zmx1ZmZyYWRpbzpfLmpkaktzPS41Z0tYcXg=';

// Cache de cookie d'auth VRChat pour réutilisation durant le runtime (évite de recréer des sessions)
let cachedVrchatAuthCookie = null;

/*
 * /lieninstance — vérifie s'il existe une instance ouverte de FluffRadio
 * et partage un lien d'invitation dans le canal.
 *
 * Configurable via variables d'environnement :
 * - VRCHAT_WORLD_ID_FLUFFRADIO : l'ID du world VRChat associé à FluffRadio (obligatoire)
 * - VRCHAT_API_KEY (optionnel) : clé API si disponible (ajoute ?apiKey=... si fournie)
 *
 * Notes :
 * - L'API VRChat nécessite parfois une authentification; ce code tente une requête publique
 *   et utilise VRCHAT_API_KEY si fournie. Si votre setup demande une auth plus complète,
 *   fournissez une couche de service externe ou adaptez l'authentification.
 * - Le format des objets renvoyés par l'API peut varier ; ce fichier essaie d'être tolérant
 *   en recherchant plusieurs champs possibles pour l'instance.
 */

export default {
  data: new SlashCommandBuilder()
    .setName('lieninstance')
    .setDescription("Annonce et partage le lien pour rejoindre l'instance FluffRadio (si ouverte)"),

  async execute(interaction) {
    // Restrict to administrators by default (assumption reasonable). Change if you want public usage.
    const member = interaction.member;
    const isAdmin = member && member.permissions && member.permissions.has && member.permissions.has(PermissionFlagsBits.Administrator);
    if (!isAdmin) {
      await interaction.reply({ content: 'Vous devez être administrateur pour utiliser cette commande.', ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: false });

    const worldId = process.env.VRCHAT_WORLD_ID_FLUFFRADIO || process.env.VRCHAT_WORLD_ID;
  // ID du groupe FluffRadio fourni par l'utilisateur
  const DEFAULT_GROUP_ID = 'grp_497a9988-e19d-43ed-9d46-bb6bfb58a4e2';
  // URL publique du groupe (page web) — fournie par l'utilisateur ici
  const DEFAULT_GROUP_URL = 'https://vrc.group/FLUFFR.2099';
  const groupId = process.env.VRCHAT_GROUP_ID_FLUFFRADIO || process.env.VRCHAT_GROUP_ID || DEFAULT_GROUP_ID;
  const groupUrl = process.env.VRCHAT_GROUP_URL || DEFAULT_GROUP_URL;
    // Si ni groupId ni worldId n'est disponible, on ne peut rien faire. Ici on a un default groupId codé,
    // donc normalement il n'y a rien à signaler. On garde une garde au cas où les deux seraient absents.
    if (!worldId && !groupId) {
      await interaction.editReply({ content: 'Configuration manquante : définissez VRCHAT_GROUP_ID_FLUFFRADIO (ou VRCHAT_GROUP_ID) ou VRCHAT_WORLD_ID dans les variables d\'environnement.', ephemeral: true });
      return;
    }

    // debug helper: store last raw API response when non-ok for diagnostics
    // declared outside the try so the catch block can access it safely
    let lastApiResponse = null;
    try {
  // Determine API key source: prefer an explicit env var. Only fall back to the
  // DEFAULT_VRCHAT_API_KEY if VRCHAT_USE_DEFAULT_API_KEY is explicitly set to '1' or 'true'.
  const envApiKey = process.env.VRCHAT_API_KEY;
  const allowDefaultApiKey = (process.env.VRCHAT_USE_DEFAULT_API_KEY === '1' || process.env.VRCHAT_USE_DEFAULT_API_KEY === 'true');
  const envCookie = process.env.VRCHAT_AUTH_COOKIE || null;
  // If an auth cookie is present, prefer it unless explicitly forced to use API key.
  const forceApiKey = (process.env.VRCHAT_FORCE_API_KEY === '1' || process.env.VRCHAT_FORCE_API_KEY === 'true');
  const useCookie = !!envCookie && !forceApiKey;
  const apiKey = (!useCookie) ? (envApiKey || (allowDefaultApiKey ? DEFAULT_VRCHAT_API_KEY : null)) : null;
  // Debug: log source of auth and masked value when VRCHAT_DEBUG is enabled.
  if (process.env.VRCHAT_DEBUG === '1' || process.env.VRCHAT_DEBUG === 'true') {
    const src = useCookie ? 'cookie' : (envApiKey ? 'env' : (allowDefaultApiKey ? 'default' : 'none'));
    const masked = useCookie ? (String(envCookie).slice(0,6) + '...') : (apiKey ? (String(apiKey).slice(0, 6) + '...') : 'none');
    console.log(`[vrchat-debug] auth source=${src} masked=${masked}`);
  }
      // Endpoint: si on a un groupId, utiliser l'endpoint dédié aux instances de groupe
      let url;
      let usingGroupEndpoint = false;
      if (groupId) {
        usingGroupEndpoint = true;
        url = `https://api.vrchat.cloud/api/1/groups/${encodeURIComponent(groupId)}/instances`;
      } else {
        // fallback: instances du world
        url = `https://api.vrchat.cloud/api/1/worlds/${encodeURIComponent(worldId)}/instances`;
      }
      // Note: we will append the apiKey to the query AFTER building headers so we
      // can also add an `X-API-Key` header for compatibility.

      // Use global fetch if available (Node 18+). If not present, caller must add a fetch polyfill.
      if (typeof fetch !== 'function') {
        throw new Error('fetch non disponible : utilisez Node 18+ ou installez un polyfill (ex: node-fetch)');
      }

      // L'API VRChat exige un User-Agent correctement formaté (nom application, version, contact).
      const defaultUserAgent = 'PelucheBot/1.0 (FluffDevs; https://github.com/FluffDevs/DiscordBotP-P)';
      const userAgent = process.env.VRCHAT_USER_AGENT || defaultUserAgent;
      const headers = {
        'Accept': 'application/json',
        'User-Agent': userAgent
      };
      // Prefer cookie auth when available (useCookie) to avoid WAF issues with Authorization on non-auth endpoints.
      if (apiKey) {
        headers['X-API-Key'] = apiKey;
      } else if (useCookie) {
        headers['Cookie'] = envCookie;
      }

      // Support login via username/password -> appel GET /auth/user avec Authorization: Basic ...
  const username = process.env.VRCHAT_USERNAME || DEFAULT_VRCHAT_USERNAME;
  const password = process.env.VRCHAT_PASSWORD || DEFAULT_VRCHAT_PASSWORD;
      try {
        // Decide auth behavior: if apiKey chosen, we already set X-API-Key above.
        // If cookie is chosen (useCookie) use it. Otherwise, if no cookie and no apiKey,
        // attempt to login with username/password to obtain a cookie (if configured).
        if (apiKey) {
          // nothing to do — X-API-Key header is present
        } else if (useCookie) {
          cachedVrchatAuthCookie = envCookie;
          headers['Cookie'] = cachedVrchatAuthCookie;
        } else if (cachedVrchatAuthCookie) {
          headers['Cookie'] = cachedVrchatAuthCookie;
        } else if (username && password) {
          // build Basic auth token: base64(urlencode(username):urlencode(password))
          const urlencode = s => encodeURIComponent(s);
          const basicRaw = `${urlencode(username)}:${urlencode(password)}`;
          const basicToken = Buffer.from(basicRaw).toString('base64');
          const loginHeaders = {
            'Accept': 'application/json',
            'User-Agent': userAgent,
            'Authorization': `Basic ${basicToken}`
          };
          // Do login request which sets auth cookie if successful
          const loginRes = await fetch('https://api.vrchat.cloud/api/1/auth/user', { method: 'GET', headers: loginHeaders });
          if (loginRes.ok) {
            // Récupérer Set-Cookie depuis les headers
            const sc = loginRes.headers.get('set-cookie') || loginRes.headers.get('Set-Cookie');
            if (sc) {
              // Normaliser : ne garder que les paires name=value et join par ; pour l'en-tête Cookie
              try {
                cachedVrchatAuthCookie = sc.split(',').map(s => s.split(';')[0].trim()).join('; ');
                headers['Cookie'] = cachedVrchatAuthCookie;
              } catch (e) {
                cachedVrchatAuthCookie = sc;
                headers['Cookie'] = sc;
              }
            }
          }
        }
      } catch (e) {
        // ignore login errors here; they will surface when requesting the instances
      }

      // Protect against long blocking fetches by using AbortController with a timeout.
      // Debug: show which headers will be sent (masked/presence only) when enabled
      if (process.env.VRCHAT_DEBUG === '1' || process.env.VRCHAT_DEBUG === 'true') {
        try {
          const xp = !!headers['X-API-Key'];
          const hasAuth = !!headers['Authorization'];
          const masked = headers['X-API-Key'] ? String(headers['X-API-Key']).slice(0,6) + '...' : 'none';
          console.log(`[vrchat-debug] sending headers -> X-API-Key present=${xp} masked=${masked} Authorization=${hasAuth}`);
        } catch (e) {
          // ignore logging errors
        }
      }
      const controller = new AbortController();
      const timeoutMs = parseInt(process.env.VRCHAT_FETCH_TIMEOUT_MS || '7000', 10);
      const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
      let res;
      let triedFallback = false;
      try {
        res = await fetch(url, { method: 'GET', headers, signal: controller.signal });
      } catch (fetchErr) {
        // Clear timer and rethrow with user-friendly message for timeouts
        clearTimeout(timeoutHandle);
        if (fetchErr && fetchErr.name === 'AbortError') {
          throw new Error(`Requête vers VRChat interrompue après ${timeoutMs}ms (timeout). Essayez de relancer la commande ou augmenter VRCHAT_FETCH_TIMEOUT_MS.`);
        }
        throw fetchErr;
      } finally {
        clearTimeout(timeoutHandle);
      }

      // Optional fallback: if API key was tried and returned 401, allow using auth cookie/login
      const allowFallback = (process.env.VRCHAT_ENABLE_FALLBACK === '1' || process.env.VRCHAT_ENABLE_FALLBACK === 'true');
      if (!res.ok && res.status === 401 && allowFallback) {
        // only attempt once
        triedFallback = true;
        try {
          // prefer explicit auth cookie env if present
          const envCookie = process.env.VRCHAT_AUTH_COOKIE;
          if (envCookie) {
            // remove API key header to avoid WAF issues, set Cookie
            delete headers['X-API-Key'];
            headers['Cookie'] = envCookie;
            if (process.env.VRCHAT_DEBUG === '1' || process.env.VRCHAT_DEBUG === 'true') console.log('[vrchat-debug] fallback -> using VRCHAT_AUTH_COOKIE');
          } else if (username && password) {
            // attempt login to obtain cookie
            const urlencode = s => encodeURIComponent(s);
            const basicRaw = `${urlencode(username)}:${urlencode(password)}`;
            const basicToken = Buffer.from(basicRaw).toString('base64');
            const loginHeaders = {
              'Accept': 'application/json',
              'User-Agent': userAgent,
              'Authorization': `Basic ${basicToken}`
            };
            const loginRes = await fetch('https://api.vrchat.cloud/api/1/auth/user', { method: 'GET', headers: loginHeaders });
            if (loginRes.ok) {
              const sc = loginRes.headers.get('set-cookie') || loginRes.headers.get('Set-Cookie');
              if (sc) {
                try {
                  cachedVrchatAuthCookie = sc.split(',').map(s => s.split(';')[0].trim()).join('; ');
                } catch (e) {
                  cachedVrchatAuthCookie = sc;
                }
                headers['Cookie'] = cachedVrchatAuthCookie;
                delete headers['X-API-Key'];
                if (process.env.VRCHAT_DEBUG === '1' || process.env.VRCHAT_DEBUG === 'true') console.log('[vrchat-debug] fallback -> obtained cookie via login');
              }
            }
          }

          // retry the instances request once with updated headers
          const retryController = new AbortController();
          const retryTimeout = parseInt(process.env.VRCHAT_FETCH_TIMEOUT_MS || '7000', 10);
          const retryHandle = setTimeout(() => retryController.abort(), retryTimeout);
          try {
            res = await fetch(url, { method: 'GET', headers, signal: retryController.signal });
          } catch (retryFetchErr) {
            clearTimeout(retryHandle);
            if (retryFetchErr && retryFetchErr.name === 'AbortError') {
              throw new Error(`Requête vers VRChat interrompue après ${retryTimeout}ms (retry timeout).`);
            }
            throw retryFetchErr;
          } finally {
            clearTimeout(retryHandle);
          }
        } catch (fbErr) {
          // ignore fallback errors here; we'll surface the original/last result below
          if (process.env.VRCHAT_DEBUG === '1' || process.env.VRCHAT_DEBUG === 'true') console.log('[vrchat-debug] fallback attempt failed', fbErr && fbErr.message ? fbErr.message : fbErr);
        }
      }
      // When an API key is provided we do not fallback to cookie/login flows —
      // the caller explicitly requested API-key-only authentication.

      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        lastApiResponse = { status: res.status, body: txt };
        // Si on reçoit 401, fournir un message d'aide plus précis
        if (res.status === 401) {
          // Detect common 2FA message and give concrete guidance
          const lower = String(txt).toLowerCase();
          if (lower.includes('two-factor') || lower.includes('two factor') || lower.includes('requires two-factor')) {
            throw new Error(`Erreur API VRChat: HTTP 401 Unauthorized (2FA requise). Le compte utilise la double authentification et ne peut pas être connecté automatiquement via username/password. Solutions :
1) Fournir une clé API via VRCHAT_API_KEY (si disponible).
2) Exporter un cookie d'authentification d'une session déjà connectée et définir VRCHAT_AUTH_COOKIE before starting the bot. Exemple PowerShell : $env:VRCHAT_AUTH_COOKIE = 'auth_cookie_string'
3) Utiliser un compte sans 2FA dédié au bot.
`);
          }
        }
        if (res.status === 403) {
          throw new Error(`Erreur API VRChat: HTTP 403 Forbidden ${txt} — vérifiez l'en-tête User-Agent (VRCHAT_USER_AGENT) et vos permissions.`);
        }
        throw new Error(`Erreur API VRChat: HTTP ${res.status} ${res.statusText} ${txt}`);
      }

      const body = await res.json();

      // L'API peut renvoyer un tableau d'instances ou un objet contenant 'instances' selon la version.
      const instances = Array.isArray(body) ? body : (Array.isArray(body.instances) ? body.instances : []);
      if (!instances.length) {
        // Aucune instance active — proposer la page du groupe
        await interaction.editReply({ content: `Aucune instance ouverte trouvée. Page du groupe: ${groupUrl}`, ephemeral: false });
        return;
      }

      // Build a list of instances (up to a limit) and send join links for each.
      const maxInstances = 10; // limit to avoid huge messages
      const toList = instances.slice(0, maxInstances);
      if (!toList.length) {
        await interaction.editReply({ content: `Aucune instance de groupe trouvée. Page du groupe: ${groupUrl}`, ephemeral: false });
        return;
      }

      // Build lines with counts and links
      const lines = toList.map((inst, idx) => {
        const rawInstance = inst.id || inst.instance || inst.instanceId || inst.location || '';
        // extract world id if included in instance (format worldId:instanceToken)
        let instWorld = inst.worldId || inst.world || worldId || '';
        if (!instWorld && typeof rawInstance === 'string' && rawInstance.includes(':')) {
          instWorld = rawInstance.split(':')[0];
        }
        const instToken = (typeof rawInstance === 'string' && rawInstance.includes(':')) ? rawInstance.split(':').slice(1).join(':') : rawInstance;
        const users = (inst.users && Array.isArray(inst.users)) ? inst.users.length : (inst.userCount || inst.nUsers || (inst.clients ? inst.clients.length : 0) || 0);
        const name = inst.name || inst.id || inst.shortName || `Instance ${idx+1}`;
        const webLink = instToken && instWorld ? `https://vrchat.com/home/launch?worldId=${encodeURIComponent(instWorld)}&instanceId=${encodeURIComponent(instToken)}` : (instWorld ? `https://vrchat.com/home/launch?worldId=${encodeURIComponent(instWorld)}` : `https://vrchat.com/home/launch?worldId=${encodeURIComponent(worldId || '')}`);
        const protocolLink = instToken && instWorld ? `vrchat://launch?worldId=${encodeURIComponent(instWorld)}:${encodeURIComponent(instToken)}` : (instWorld ? `vrchat://launch?worldId=${encodeURIComponent(instWorld)}` : `vrchat://launch?worldId=${encodeURIComponent(worldId || '')}`);

        // Try several possible fields for the "locked/short" invite link that appears in the web UI
        // Common candidates returned by different API versions: shortUrl, short_url, lockedUrl, locked_link, inviteUrl, inviteCode
        let lockedLink = null;
        if (inst.shortUrl) lockedLink = inst.shortUrl;
        else if (inst.short_url) lockedLink = inst.short_url;
        else if (inst.lockedUrl) lockedLink = inst.lockedUrl;
        else if (inst.locked_link) lockedLink = inst.locked_link;
        else if (inst.inviteUrl) lockedLink = inst.inviteUrl;
        else if (inst.invite_url) lockedLink = inst.invite_url;
        else if (inst.inviteCode) lockedLink = `https://vrch.at/${String(inst.inviteCode)}`;
        else if (inst.invite_code) lockedLink = `https://vrch.at/${String(inst.invite_code)}`;

        // As a final fallback, some APIs expose 'link' or 'url'
        if (!lockedLink && inst.link) lockedLink = inst.link;
        if (!lockedLink && inst.url) lockedLink = inst.url;

        // Build output line; include locked link when available
        const parts = [];
        parts.push(`• ${name} — ${users} utilisateur(s)`);
        if (lockedLink) {
          parts.push(`Locked: ${lockedLink}`);
        } else {
          parts.push(`${webLink}`);
        }
        parts.push(`(vrchat: ${protocolLink})`);
        return parts.join(' — ');
      });

      let footer = '';
      if (instances.length > maxInstances) footer = `\n...et ${instances.length - maxInstances} autres instances.`;
      const mention = '@everyone';
      const message = `${mention} Instances ouvertes pour FluffRadio :\n${lines.join('\n')}${footer}\nPage du groupe: ${groupUrl}`;

      await interaction.editReply({ content: message, allowedMentions: { parse: ['everyone'] } });
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      // If debug mode enabled, include raw API response (truncated) in the reply to help debugging
      const debugEnabled = (process.env.VRCHAT_DEBUG === '1' || process.env.VRCHAT_DEBUG === 'true');
      try {
        if (debugEnabled && lastApiResponse) {
          const raw = String(lastApiResponse.body || '').slice(0, 1500);
          const extra = `\n---\nDebug API response (status ${lastApiResponse.status}):\n${raw}${String(lastApiResponse.body || '').length > 1500 ? '\n...(truncated)' : ''}`;
          await interaction.editReply({ content: `Erreur lors de la vérification de l'instance VRChat : ${msg}${extra}`, ephemeral: true });
        } else {
          await interaction.editReply({ content: `Erreur lors de la vérification de l'instance VRChat : ${msg}`, ephemeral: true });
        }
      } catch (e) {
        // ignore
      }
    }
  }
};
