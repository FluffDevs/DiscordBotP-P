(async ()=>{
  try {
    const tg = await import('../src/telegram.js');
    console.log('telegram.loaded', typeof tg.default.getQueue==='function');
    console.log('telegram.queueLen', tg.default.getQueue().length);
    const l = await import('../src/slash-commands/liste.js');
    console.log('liste.loaded', !!l.default && l.default.data && l.default.execute ? 'ok' : 'bad');
    const f = await import('../src/slash-commands/flush-telegram.js');
    console.log('flush.loaded', !!f.default && f.default.data && f.default.execute ? 'ok' : 'bad');
    // allow logs to flush then exit to avoid interval keeping process alive
    setTimeout(()=>process.exit(0), 200);
  } catch (e) { console.error('ERR', e && e.stack ? e.stack : e); process.exit(1); }
})();
