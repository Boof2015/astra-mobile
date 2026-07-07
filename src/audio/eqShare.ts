import type { EQPreset } from '../types/audio';
import {
  parseEQPresetData,
  serializeEQPresetData,
} from './eq.ts';

export const EQ_PRESET_FILE_EXTENSION = 'astraeq';
export const EQ_PRESET_MIME_TYPE = 'application/vnd.astra.eq-preset+json';
export const EQ_PRESET_QR_PREFIX = 'astra:eq-preset:v1:';

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function stringToUtf8Bytes(value: string): number[] {
  const bytes: number[] = [];
  for (const char of value) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(0xe0 | (codePoint >> 12), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f));
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f)
      );
    }
  }
  return bytes;
}

function utf8BytesToString(bytes: readonly number[]): string {
  let result = '';
  for (let i = 0; i < bytes.length; i += 1) {
    const first = bytes[i];
    if (first <= 0x7f) {
      result += String.fromCodePoint(first);
      continue;
    }
    if ((first & 0xe0) === 0xc0) {
      const second = bytes[++i];
      if (second === undefined) throw new Error('Invalid preset QR');
      result += String.fromCodePoint(((first & 0x1f) << 6) | (second & 0x3f));
      continue;
    }
    if ((first & 0xf0) === 0xe0) {
      const second = bytes[++i];
      const third = bytes[++i];
      if (second === undefined || third === undefined) throw new Error('Invalid preset QR');
      result += String.fromCodePoint(((first & 0x0f) << 12) | ((second & 0x3f) << 6) | (third & 0x3f));
      continue;
    }
    if ((first & 0xf8) === 0xf0) {
      const second = bytes[++i];
      const third = bytes[++i];
      const fourth = bytes[++i];
      if (second === undefined || third === undefined || fourth === undefined) {
        throw new Error('Invalid preset QR');
      }
      result += String.fromCodePoint(
        ((first & 0x07) << 18) | ((second & 0x3f) << 12) | ((third & 0x3f) << 6) | (fourth & 0x3f)
      );
      continue;
    }
    throw new Error('Invalid preset QR');
  }
  return result;
}

function base64UrlEncode(value: string): string {
  const bytes = stringToUtf8Bytes(value);
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const first = bytes[i];
    const second = bytes[i + 1];
    const third = bytes[i + 2];
    const triple = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
    result += BASE64_ALPHABET[(triple >> 18) & 0x3f];
    result += BASE64_ALPHABET[(triple >> 12) & 0x3f];
    result += second === undefined ? '=' : BASE64_ALPHABET[(triple >> 6) & 0x3f];
    result += third === undefined ? '=' : BASE64_ALPHABET[triple & 0x3f];
  }
  return result.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value: string): string {
  if (!/^[A-Za-z0-9_-]*$/.test(value) || value.length % 4 === 1) {
    throw new Error('Invalid preset QR');
  }
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const bytes: number[] = [];
  for (let i = 0; i < padded.length; i += 4) {
    const a = BASE64_ALPHABET.indexOf(padded[i]);
    const b = BASE64_ALPHABET.indexOf(padded[i + 1]);
    const c = padded[i + 2] === '=' ? -1 : BASE64_ALPHABET.indexOf(padded[i + 2]);
    const d = padded[i + 3] === '=' ? -1 : BASE64_ALPHABET.indexOf(padded[i + 3]);
    if (a < 0 || b < 0 || (c < 0 && padded[i + 2] !== '=') || (d < 0 && padded[i + 3] !== '=')) {
      throw new Error('Invalid preset QR');
    }
    const triple = (a << 18) | (b << 12) | ((c < 0 ? 0 : c) << 6) | (d < 0 ? 0 : d);
    bytes.push((triple >> 16) & 0xff);
    if (c >= 0) bytes.push((triple >> 8) & 0xff);
    if (d >= 0) bytes.push(triple & 0xff);
  }
  return utf8BytesToString(bytes);
}

export function sanitizeEQPresetFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, '_').trim();
  return cleaned || 'Astra EQ Preset';
}

export function buildEQPresetFileName(name: string): string {
  return `${sanitizeEQPresetFileName(name)}.${EQ_PRESET_FILE_EXTENSION}`;
}

export function stringifyEQPresetFileContents(preset: EQPreset): string {
  return `${JSON.stringify(serializeEQPresetData(preset), null, 2)}\n`;
}

export function parseEQPresetFileContents(contents: string, createId: () => string): EQPreset {
  try {
    return parseEQPresetData(JSON.parse(contents), createId);
  } catch (error) {
    if (error instanceof Error && error.message === 'Unsupported preset version') {
      throw error;
    }
    throw new Error('Invalid Astra EQ preset file');
  }
}

export function encodeEQPresetQr(preset: EQPreset): string {
  return `${EQ_PRESET_QR_PREFIX}${base64UrlEncode(JSON.stringify(serializeEQPresetData(preset)))}`;
}

export function decodeEQPresetQr(value: string, createId: () => string): EQPreset {
  const trimmed = value.trim();
  if (!trimmed.startsWith(EQ_PRESET_QR_PREFIX)) {
    throw new Error('Not an Astra EQ preset QR');
  }
  try {
    return parseEQPresetData(JSON.parse(base64UrlDecode(trimmed.slice(EQ_PRESET_QR_PREFIX.length))), createId);
  } catch (error) {
    if (error instanceof Error && error.message === 'Not an Astra EQ preset QR') {
      throw error;
    }
    throw new Error('Invalid Astra EQ preset QR');
  }
}
