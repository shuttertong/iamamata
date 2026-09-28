// Sound keys so an English query finds a Thai-script company name: "Toyota" → โตโยต้า,
// "Mitsubishi" → มิตซูบิชิ, "NOK" → เอ็นโอเค. Most company names here are English or Japanese
// words written in Thai, so both sides are reduced to the same rough key:
// consonants in a shared alphabet + one generic vowel "a", with repeats merged.
// Matching is approximate (see soundDistance), so small spelling differences don't matter.

const TH_CONS = {
  ก: 'k', ข: 'k', ฃ: 'k', ค: 'k', ฅ: 'k', ฆ: 'k', ง: 'n',
  จ: 'c', ฉ: 'c', ช: 'c', ฌ: 'c', ซ: 's', ศ: 's', ษ: 's', ส: 's',
  ญ: 'y', ย: 'y', ฎ: 'd', ด: 'd', ฏ: 't', ต: 't', ฐ: 't', ฑ: 't', ฒ: 't', ถ: 't', ท: 't', ธ: 't',
  ณ: 'n', น: 'n', บ: 'b', ป: 'p', ผ: 'p', พ: 'p', ภ: 'p', ฝ: 'f', ฟ: 'f', ม: 'm',
  ร: 'r', ล: 'l', ฬ: 'l', ว: 'w', ห: '', ฮ: '', อ: 'a',
};
const TH_VOWEL = 'ะัาิีึืุูๅ็';
const TH_LEAD = 'เแโใไ';            // written before the consonant, said after it
const TH_TONE = '่้๊๋ํ';
const CLUSTER = 'รลว';               // second letter of a cluster: เปร → p r e

/** Shared final step: drop h, all vowels (and y/w glides) → a, merge repeats, no spaces. */
const squash = (k) => k.replace(/[^a-z]/g, '').replace(/h/g, '').replace(/[aeiouyw]+/g, 'a').replace(/(.)\1+/g, '$1');

/** Thai text (may contain Latin letters) → sound key. */
export function thaiKey(s) {
  const ch = [...(s || '')];
  const out = [];
  let lead = false;
  for (let i = 0; i < ch.length; i++) {
    const c = ch[i];
    if (TH_LEAD.includes(c)) { lead = true; continue; }
    if (c in TH_CONS) {
      out.push(TH_CONS[c]);
      if (lead) {
        const n = ch[i + 1];
        if (n && CLUSTER.includes(n) && ch[i + 2] && !(TH_VOWEL + TH_TONE + '์').includes(ch[i + 2])) { out.push(TH_CONS[n]); i++; }
        out.push('a');
        lead = false;
      }
    } else if (c === '์') {
      // thanthakhat: the consonant before it is silent (ซีเมนต์ → siment → simen)
      for (let j = out.length - 1; j >= 0; j--) if (out[j] !== 'a') { out.splice(j, 1); break; }
    } else if (c === 'ำ') out.push('am');
    else if (c === 'ฤ') out.push('ra');
    else if (TH_VOWEL.includes(c)) out.push('a');
    else if (/[a-z]/i.test(c)) out.push(latinKey(c));
    else if (TH_TONE.includes(c)) { /* tone marks: no sound change we care about */ } else out.push(' ');
  }
  return squash(out.join(''));
}

/** English / romanised text → sound key in the same alphabet as thaiKey. */
export function latinKey(s) {
  const k = (s || '').toLowerCase().replace(/[^a-z\s]/g, ' ')
    .replace(/tion\b/g, 'Cn').replace(/ng/g, 'n')
    .replace(/tch|sch|ch|sh|j/g, 'C')
    .replace(/ph/g, 'p').replace(/th/g, 't').replace(/kh/g, 'k').replace(/gh/g, '')
    .replace(/ck/g, 'k').replace(/qu/g, 'kw').replace(/q/g, 'k').replace(/x/g, 'ks')
    .replace(/c(?=[eiy])/g, 's').replace(/c/g, 'k').replace(/C/g, 'c')
    .replace(/z/g, 's').replace(/v/g, 'w').replace(/g/g, 'k')
    .replace(/r(?![aeiouy])/g, '')    // Thai spellings drop an r before a consonant or at the end
    .replace(/([^aeiou\s])s\b/g, '$1');  // …and a final s after a consonant (คิงส์ = kings)
  return squash(k);
}

// Letter names as written in Thai, for acronyms: "NOK" → เอ็น โอ เค.
const LETTER = {
  a: 'เอ', b: 'บี', c: 'ซี', d: 'ดี', e: 'อี', f: 'เอฟ', g: 'จี', h: 'เอช', i: 'ไอ', j: 'เจ', k: 'เค', l: 'แอล', m: 'เอ็ม',
  n: 'เอ็น', o: 'โอ', p: 'พี', q: 'คิว', r: 'อาร์', s: 'เอส', t: 'ที', u: 'ยู', v: 'วี', w: 'ดับเบิลยู', x: 'เอ็กซ์', y: 'วาย', z: 'แซด',
};

/** Keys to try for a query: as a word, and (for short queries) spelled out letter by letter. */
export function queryKeys(q) {
  const keys = [latinKey(q)];
  const letters = q.replace(/[^a-z]/gi, '').toLowerCase();
  if (letters.length >= 2 && letters.length <= 5) keys.push(thaiKey([...letters].map((c) => LETTER[c]).join('')));
  return [...new Set(keys.filter((k) => k.length >= 2))];
}

/** Smallest edit distance between q and any substring of text (Sellers' algorithm). */
export function soundDistance(text, q) {
  let prev = new Array(q.length + 1).fill(0).map((_, i) => i);
  let best = prev[q.length];
  for (let j = 1; j <= text.length; j++) {
    const cur = [0];
    for (let i = 1; i <= q.length; i++) {
      cur[i] = Math.min(prev[i] + 1, cur[i - 1] + 1, prev[i - 1] + (q[i - 1] === text[j - 1] ? 0 : 1));
    }
    best = Math.min(best, cur[q.length]);
    prev = cur;
  }
  return best;
}

/** Per-word keys of a multi-word query (words of 3+ sounds), for "every word sounds right" matches. */
export const wordKeys = (q) => q.split(/\s+/).map(latinKey).filter((k) => k.length >= 3);

/** Allowed distance: exact for very short keys, 1 for medium, 2 for long. */
export const soundTolerance = (k) => (k.length <= 3 ? 0 : k.length <= 7 ? 1 : 2);

function lev(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** Distance between q and the start of word key w (w may be a little longer or shorter). */
const prefixDist = (w, q) => Math.min(...[q.length - 1, q.length, q.length + 1].filter((n) => n > 0).map((n) => lev(w.slice(0, n), q)));

/**
 * How well a Latin query sounds like a Thai name, 0 = no match, up to ~1.
 * nameWords: sound keys of the name's words. nameKey: sound key of the whole name.
 * Tiers: a word sounds exactly like the query (0.95) > a word starts like it (≤ 0.8)
 * > every query word starts a name word (≤ 0.85) > the sound appears inside the name (≤ 0.3, long queries only).
 */
export function soundScore(nameWords, nameKey, query) {
  const keys = queryKeys(query);
  const words = wordKeys(query);
  let best = 0;
  for (const k of keys) {
    const tol = soundTolerance(k);
    nameWords.forEach((w, i) => {
      const first = i === 0 ? 0.04 : 0;
      if (w === k) best = Math.max(best, 0.95 + first);
      else {
        const d = prefixDist(w, k);
        if (d <= tol) best = Math.max(best, 0.8 - 0.1 * d + first);
      }
    });
    if (!best && k.length >= 5) {
      const d = soundDistance(nameKey, k);
      if (d <= tol) best = 0.3 - 0.05 * d;
    }
  }
  if (words.length > 1) {
    let sum = 0;
    const all = words.every((k) => {
      const d = Math.min(...nameWords.map((w) => prefixDist(w, k)));
      sum += d;
      return d <= soundTolerance(k);
    });
    if (all) best = Math.max(best, 0.85 - 0.05 * sum);
  }
  return best;
}
