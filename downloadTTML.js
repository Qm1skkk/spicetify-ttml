// NAME: Download TTML
// DESCRIPTION: Download current track lyrics as TTML from the Spotify server

(async () => {
  while (!window.Spicetify || !Spicetify.Topbar || !Spicetify.Player) {
    await new Promise(r => setTimeout(r, 200));
  }
  if (window.__ttmlExtInstalled) return;
  window.__ttmlExtInstalled = true;

  const { CosmosAsync, Player, showNotification, Topbar } = Spicetify;

  function cleanName(n) {
    return (n || '')
      .replace(/\s*[\(\[].*?(feat|ft|featuring|with).*?[\)\]]/gi, '')
      .replace(/[\(\[].*?[\)\]]/g, '')
      .replace(/\s*-\s*.*$/, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function fmt(ms) {
    ms = Math.max(0, Math.round(Number(ms) || 0));
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const r = ms % 1000;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(r).padStart(3, '0')}`;
  }

  function esc(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function download(filename, text) {
    const blob = new Blob([text], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function buildTTML(title, artist, lines) {
    const body = lines
      .map(l => `      <p begin="${l.begin}" end="${l.end}">${esc(l.text)}</p>`)
      .join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml">
  <head>
    <metadata>
      <title>${esc(title)}</title>
      <artist>${esc(artist)}</artist>
    </metadata>
  </head>
  <body>
    <div begin="00:00.000" end="99:59.999">
${body}
    </div>
  </body>
</tt>`;
  }

  async function getSpclient(trackId) {
    const url = `https://spclient.wg.spotify.com/color-lyrics/v2/track/${trackId}?format=json&vocalRemoval=false&market=from_token`;
    const data = await CosmosAsync.get(url);
    if (!data || !data.lyrics || !Array.isArray(data.lyrics.lines)) return null;
    return data.lyrics.lines
      .map((l, i, arr) => {
        const start = Number(l.startTimeMs) || 0;
        const next = arr[i + 1] ? Number(arr[i + 1].startTimeMs) || 0 : start;
        const end = l.endTimeMs ? Number(l.endTimeMs) : next || start + 3000;
        return { begin: fmt(start), end: fmt(end), text: l.words || '' };
      })
      .filter(l => l.text.trim().length);
  }

  async function lrclibReq(params) {
    const qs = new URLSearchParams(params).toString();
    const r = await fetch(`https://lrclib.net/api/get?${qs}`);
    if (!r.ok) return null;
    return await r.json();
  }

  async function getLrclib(track) {
    const title = cleanName(track.title);
    const artist = cleanName(track.artist);
    const album = cleanName(track.album);
    const dur = Math.round((track.duration || 0) / 1000);
    const tries = [
      { track_name: title, artist_name: artist, album_name: album, duration: dur },
      { track_name: title, artist_name: artist, album_name: album },
      { track_name: title, artist_name: artist }
    ];
    for (const p of tries) {
      try {
        const m = await lrclibReq(p);
        if (m && (m.syncedLyrics || m.plainLyrics)) return m;
      } catch (e) {}
    }
    return null;
  }

  async function getLrclibSearch(track) {
    const q = `${cleanName(track.artist)} ${cleanName(track.title)}`;
    try {
      const r = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`);
      if (!r.ok) return null;
      const arr = await r.json();
      if (Array.isArray(arr)) {
        for (const m of arr) {
          if (m && (m.syncedLyrics || m.plainLyrics)) return m;
        }
      }
    } catch (e) {}
    return null;
  }

  function linesFromLrclib(m) {
    if (m.syncedLyrics) {
      return m.syncedLyrics
        .split('\n')
        .map(line => {
          const mm = line.match(/^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/);
          if (!mm) return null;
          const t = +mm[1] * 60000 + +mm[2] * 1000;
          return { begin: fmt(t), end: fmt(t + 3000), text: mm[3].trim() };
        })
        .filter(Boolean);
    }
    if (m.plainLyrics) {
      return m.plainLyrics
        .split('\n')
        .filter(l => l.trim())
        .map(l => ({ begin: fmt(0), end: fmt(0), text: l.trim() }));
    }
    return null;
  }

  const MUSIX_TOKEN = '2005218b74f939209bda92cb633c7380612e14cb7fe92dcd6a780f';
  async function getMusixmatch(track) {
    const base = 'https://apic-desktop.musixmatch.com/ws/1.1/';
    try {
      const m1 = await fetch(
        `${base}matcher.track.get?format=json&q_track=${encodeURIComponent(track.title)}&q_artist=${encodeURIComponent(track.artist)}&apikey=${MUSIX_TOKEN}`
      );
      if (!m1.ok) return null;
      const j1 = await m1.json();
      const tid = j1 && j1.message && j1.message.body && j1.message.body.track && j1.message.body.track.track_id;
      if (!tid) return null;
      const m2 = await fetch(`${base}track.lyrics.get?format=json&track_id=${tid}&apikey=${MUSIX_TOKEN}`);
      if (!m2.ok) return null;
      const j2 = await m2.json();
      const lyr = j2 && j2.message && j2.message.body && j2.message.body.lyrics && j2.message.body.lyrics.lyrics_body;
      if (!lyr) return null;
      return lyr
        .split('\n')
        .filter(l => l.trim())
        .map(l => ({ begin: fmt(0), end: fmt(0), text: l.trim() }));
    } catch (e) {
      return null;
    }
  }

  async function onClick() {
    const data = Player.data;
    if (!data || !data.item) {
      showNotification('Нет играющего трека');
      return;
    }
    const meta = {
      title: data.item.name,
      artist: (data.item.artists || []).map(a => a.name).join(', '),
      album: data.item.album ? data.item.album.name : '',
      duration:
        (data.item.duration && data.item.duration.milliseconds) ||
        (typeof data.item.duration === 'number' ? data.item.duration * 1000 : 0) ||
        Player.getDuration() ||
        0,
      uri: data.item.uri
    };
    const trackId = meta.uri.split(':')[2];

    showNotification('Ищем текст (Spotify)...');
    let lines = null;
    let source = '';
    try {
      lines = await getSpclient(trackId);
      if (lines) source = 'Spotify';
    } catch (e) {
      console.warn('spclient failed', e);
    }
    if (!lines) {
      const m = (await getLrclib(meta)) || (await getLrclibSearch(meta));
      if (m) {
        lines = linesFromLrclib(m);
        source = 'lrclib';
      }
    }
    if (!lines) {
      lines = await getMusixmatch(meta);
      if (lines) source = 'Musixmatch';
    }
    if (!lines || !lines.length) {
      showNotification('Не нашли текст (Spotify + lrclib + Musixmatch)');
      return;
    }
    const ttml = buildTTML(meta.title, meta.artist, lines);
    const fname = `${meta.artist} - ${meta.title}.ttml`.replace(/[\\/:*?"<>|]/g, '_');
    download(fname, ttml);
    showNotification(`Download TTML: готово (${source})`);
  }

  new Topbar.Button('TTML (Spotify server)', 'download', onClick, false, true);
})();
