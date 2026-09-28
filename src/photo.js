// Photo preparation in the browser: taken time (EXIF), downsize + strip metadata, perceptual hash.
import { CONFIG } from './config.js';

/** file → { blob (JPEG, no EXIF), takenAt (ISO), hash (16 hex), preview (object URL) } */
export async function preparePhoto(file) {
  if (!file.type.startsWith('image/')) throw new Error('not_image');
  if (file.size > CONFIG.photo.maxInputMB * 1048576) throw new Error('too_big');
  const taken = (await readTakenAt(file)) || new Date(file.lastModified || Date.now());
  const img = await loadImage(file);
  const blob = await encode(img, CONFIG.photo.maxSide, CONFIG.photo.quality);
  const hash = dHash(img);
  URL.revokeObjectURL(img.src);
  const takenAt = new Date(Math.min(taken.getTime(), Date.now())).toISOString();
  return { blob, takenAt, hash, preview: URL.createObjectURL(blob) };
}

// <img> applies the EXIF orientation when drawn to a canvas in current browsers.
function loadImage(file) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('decode_failed'));
    img.src = URL.createObjectURL(file);
  });
}

// Re-encoding through a canvas drops every EXIF field, GPS included.
function encode(img, maxSide, quality) {
  const s = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * s);
  c.height = Math.round(img.naturalHeight * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encode_failed'))), 'image/jpeg', quality));
}

/** 64-bit difference hash: survives resizing and re-compression, so re-posted photos match. */
function dHash(img) {
  const c = document.createElement('canvas');
  c.width = 9; c.height = 8;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, 9, 8);
  const px = g.getImageData(0, 0, 9, 8).data;
  const lum = (i) => px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114;
  let hex = '';
  for (let y = 0; y < 8; y++) {
    let nib = 0;
    for (let x = 0; x < 8; x++) {
      nib = (nib << 1) | (lum(y * 9 + x) > lum(y * 9 + x + 1) ? 1 : 0);
      if (x % 4 === 3) { hex += nib.toString(16); nib = 0; }
    }
  }
  return hex;
}

/** Number of differing bits between two dHash strings. */
export function hamming(a, b) {
  let d = 0;
  for (let i = 0; i < 16; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) { d += x & 1; x >>= 1; }
  }
  return d;
}

/** EXIF DateTimeOriginal (or DateTime) from a JPEG, as local time; null when missing. */
async function readTakenAt(file) {
  try {
    const v = new DataView(await file.slice(0, 131072).arrayBuffer());
    if (v.getUint16(0) !== 0xffd8) return null;
    let off = 2;
    while (off + 10 < v.byteLength) {
      const marker = v.getUint16(off);
      if ((marker & 0xff00) !== 0xff00) break;
      if (marker === 0xffe1 && v.getUint32(off + 4) === 0x45786966) return parseTiffDate(v, off + 10);
      off += 2 + v.getUint16(off + 2);
    }
  } catch { /* unreadable EXIF: fall back to the file time */ }
  return null;
}

function parseTiffDate(v, t) {
  const le = v.getUint16(t) === 0x4949;
  const u16 = (o) => v.getUint16(t + o, le);
  const u32 = (o) => v.getUint32(t + o, le);
  const find = (ifd, tag) => {
    const n = u16(ifd);
    for (let i = 0; i < n; i++) if (u16(ifd + 2 + i * 12) === tag) return ifd + 2 + i * 12;
    return -1;
  };
  const ifd0 = u32(4);
  const exif = find(ifd0, 0x8769);
  let e = exif >= 0 ? find(u32(exif + 8), 0x9003) : -1;
  if (e < 0) e = find(ifd0, 0x0132);
  if (e < 0) return null;
  const at = u32(e + 8);
  let s = '';
  for (let i = 0; i < 19; i++) s += String.fromCharCode(v.getUint8(t + at + i));
  const m = s.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
}
