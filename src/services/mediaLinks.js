/**
 * Media link helpers shared by the student course viewer and tests.
 */

/** YouTube video id from watch / youtu.be / embed / shorts / live links ('' when not a video link). */
export function youtubeVideoId(url) {
  try {
    const u = new URL(String(url || '').trim());
    const host = u.hostname.replace(/^www\.|^m\./, '');
    let id = '';
    if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
    else if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
      id = u.searchParams.get('v') || (u.pathname.match(/^\/(embed|shorts|live)\/([^/?#]+)/)?.[2] || '');
    }
    return /^[A-Za-z0-9_-]{6,20}$/.test(id) ? id : '';
  } catch {
    return '';
  }
}

/** True for Google Drive / Docs / Slides / Sheets links (drive.google.com, docs.google.com). */
export function isGoogleDocsUrl(url) {
  try {
    const u = new URL(String(url || '').trim());
    return (u.protocol === 'https:' || u.protocol === 'http:') && /(^|\.)(drive|docs)\.google\.com$/i.test(u.hostname);
  } catch {
    return false;
  }
}

/** Drops sentence punctuation (and unbalanced closing brackets) that follow a link in text. */
function trimLinkEnd(url) {
  let out = url;
  for (;;) {
    const last = out.slice(-1);
    const count = (ch) => out.split(ch).length - 1;
    if (/[.,;:!?'"]/.test(last)) out = out.slice(0, -1);
    else if (last === ')' && count(')') > count('(')) out = out.slice(0, -1);
    else if (last === ']' && count(']') > count('[')) out = out.slice(0, -1);
    else return out;
  }
}

/**
 * Splits message text into plain parts and http(s) link parts, for rendering clickable links safely:
 * [{ text }, { text, href }, …]. Nothing else (javascript:, data:, …) ever becomes a link.
 */
export function splitTextLinks(text) {
  const value = String(text ?? '');
  const parts = [];
  let cursor = 0;
  for (const match of value.matchAll(/https?:\/\/[^\s<>"'`]+/gi)) {
    const url = trimLinkEnd(match[0]);
    let valid = false;
    try {
      const parsed = new URL(url);
      valid = (parsed.protocol === 'https:' || parsed.protocol === 'http:') && Boolean(parsed.hostname);
    } catch {
      valid = false;
    }
    if (!valid) continue;
    if (match.index > cursor) parts.push({ text: value.slice(cursor, match.index) });
    parts.push({ text: url, href: url });
    cursor = match.index + url.length;
  }
  if (cursor < value.length) parts.push({ text: value.slice(cursor) });
  return parts;
}
