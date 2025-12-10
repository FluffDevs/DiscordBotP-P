#!/usr/bin/env node
// Quick diagnostic script to check VRChat API key access for group instances
// Usage: node scripts/check_vrchat_key.js

const groupEnv = process.env.VRCHAT_GROUP_ID_FLUFFRADIO || process.env.VRCHAT_GROUP_ID || 'grp_497a9988-e19d-43ed-9d46-bb6bfb58a4e2';
// Placeholder default kept only for manual testing when explicitly allowed.
const DEFAULT_VRCHAT_API_KEY = 'Zmx1ZmZyYWRpbzpfLmpkaktzPS41Z0tYcXg=';
const apiKey = process.env.VRCHAT_API_KEY || (process.env.VRCHAT_USE_DEFAULT_API_KEY === '1' ? DEFAULT_VRCHAT_API_KEY : null);
const userAgent = process.env.VRCHAT_USER_AGENT || 'PelucheBot/1.0 (FluffDevs; https://github.com/FluffDevs/DiscordBotP-P)';

function masked(s) {
  if (!s) return 'none';
  const st = String(s);
  return st.length <= 6 ? st + '...' : st.slice(0,6) + '...';
}

async function main() {
  console.log('VRChat key diagnostic');
  console.log('Group:', groupEnv);
  const authCookie = process.env.VRCHAT_AUTH_COOKIE || null;
  console.log('API key present:', !!apiKey, 'masked=', masked(apiKey));
  console.log('Auth cookie present:', !!authCookie);

  if (!apiKey && !authCookie) {
    console.error('No VRCHAT_API_KEY or VRCHAT_AUTH_COOKIE in environment. Set $env:VRCHAT_API_KEY or $env:VRCHAT_AUTH_COOKIE and retry.');
    process.exitCode = 2;
    return;
  }

  const url = `https://api.vrchat.cloud/api/1/groups/${encodeURIComponent(groupEnv)}/instances`;
  const headers = {
    'Accept': 'application/json',
    'User-Agent': userAgent
  };
  // If an API key is present, prefer it. Otherwise, use the supplied auth cookie.
  if (apiKey) headers['X-API-Key'] = apiKey;
  else if (authCookie) headers['Cookie'] = authCookie;

  console.log('Calling', url);
  try {
    const res = await fetch(url, { method: 'GET', headers });
    const status = res.status;
    let bodyText = '';
    try { bodyText = await res.text(); } catch (e) { bodyText = '<unable to read body>'; }
    console.log('HTTP', status);
    try {
      const json = JSON.parse(bodyText);
      console.log('Body (json):', JSON.stringify(json, null, 2));
    } catch (e) {
      console.log('Body (text):', bodyText);
    }
    if (status === 200) {
      console.log('Success: API key works for group instances.');
    } else if (status === 401) {
      console.log('Unauthorized: API reports missing/invalid credentials.');
      process.exitCode = 3;
    } else if (status === 403) {
      console.log('Forbidden: check User-Agent or key permissions.');
      process.exitCode = 4;
    } else {
      console.log('Unexpected status code:', status);
      process.exitCode = 5;
    }
  } catch (err) {
    console.error('Fetch failed:', err && err.message ? err.message : String(err));
    process.exitCode = 1;
  }
}

main();
