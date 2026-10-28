/* eslint @typescript-eslint/explicit-function-return-type: off -- Native Node CLI uses JavaScript. */
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { assertSafePath } from '../assets/import-state.mjs';

/** Embedded pictures are small; anything larger is treated as corrupt instead of being buffered. */
const MAX_PICTURE_BYTES = 16 * 1024 * 1024;
const MAX_TAG_BYTES = 32 * 1024 * 1024;
const FRONT_COVER = 3;

async function readAt(handle, position, length) {
  const buffer = Buffer.alloc(length);
  let filled = 0;
  while (filled < length) {
    const { bytesRead } = await handle.read(buffer, filled, length - filled, position + filled);
    if (bytesRead === 0) break;
    filled += bytesRead;
  }
  return buffer.subarray(0, filled);
}

async function readExactly(handle, position, length) {
  const bytes = await readAt(handle, position, length);
  if (bytes.length !== length) throw new Error('Unexpected end of file');
  return bytes;
}

function syncsafe(bytes) {
  if (bytes.some((byte) => byte & 0x80)) throw new Error('Invalid ID3 size');
  return (bytes[0] << 21) | (bytes[1] << 14) | (bytes[2] << 7) | bytes[3];
}

/** FLAC `PICTURE` block body, also used by Ogg `METADATA_BLOCK_PICTURE`. Returns null for linked pictures. */
function parseFlacPicture(block) {
  let offset = 0;
  const readUInt32 = () => {
    if (offset + 4 > block.length) throw new Error('Truncated picture block');
    const value = block.readUInt32BE(offset);
    offset += 4;
    return value;
  };
  const readBytes = (length) => {
    if (length > block.length - offset) throw new Error('Truncated picture block');
    const value = block.subarray(offset, offset + length);
    offset += length;
    return value;
  };
  const type = readUInt32();
  const mime = readBytes(readUInt32()).toString('latin1');
  readBytes(readUInt32());
  readBytes(16);
  const data = readBytes(readUInt32());
  if (mime === '-->' || data.length === 0) return null;
  return { type, data };
}

async function* oggPackets(handle) {
  let position = 0;
  let pending = [];
  let pendingBytes = 0;
  while (position < MAX_TAG_BYTES) {
    const header = await readAt(handle, position, 27);
    if (header.length < 27 || header.toString('latin1', 0, 4) !== 'OggS') throw new Error('Invalid Ogg page');
    const table = await readExactly(handle, position + 27, header[26]);
    const body = await readExactly(handle, position + 27 + table.length, table.reduce((sum, value) => sum + value, 0));
    position += 27 + table.length + body.length;
    let bodyOffset = 0;
    for (const length of table) {
      pending.push(body.subarray(bodyOffset, bodyOffset + length));
      pendingBytes += length;
      bodyOffset += length;
      if (pendingBytes > MAX_TAG_BYTES) throw new Error('Ogg packet is too large');
      if (length < 255) {
        yield Buffer.concat(pending);
        pending = [];
        pendingBytes = 0;
      }
    }
  }
  throw new Error('Ogg headers are too large');
}

/** Opus and Vorbis keep Vorbis-style comments in the second packet of the first stream. */
async function oggPictures(handle) {
  let index = 0;
  for await (const packet of oggPackets(handle)) {
    if (index === 0) {
      if (!packet.subarray(0, 8).equals(Buffer.from('OpusHead')) && !packet.subarray(0, 7).equals(Buffer.from('\x01vorbis'))) return [];
    } else {
      const opus = packet.subarray(0, 8).equals(Buffer.from('OpusTags'));
      if (!opus && !packet.subarray(0, 7).equals(Buffer.from('\x03vorbis'))) return [];
      return vorbisCommentPictures(packet, opus ? 8 : 7);
    }
    index += 1;
  }
  return [];
}

function vorbisCommentPictures(packet, start) {
  let offset = start;
  const readLength = () => {
    if (offset + 4 > packet.length) throw new Error('Truncated comment header');
    const value = packet.readUInt32LE(offset);
    offset += 4;
    return value;
  };
  const vendorLength = readLength();
  offset += vendorLength;
  const count = readLength();
  const pictures = [];
  for (let index = 0; index < count; index += 1) {
    const length = readLength();
    if (length > packet.length - offset) throw new Error('Truncated comment');
    const entry = packet.toString('latin1', offset, offset + length);
    offset += length;
    const separator = entry.indexOf('=');
    if (separator > 0 && entry.slice(0, separator).toUpperCase() === 'METADATA_BLOCK_PICTURE') {
      const picture = parseFlacPicture(Buffer.from(entry.slice(separator + 1), 'base64'));
      if (picture) pictures.push(picture);
    }
  }
  return pictures;
}

async function flacPictures(handle, start) {
  const pictures = [];
  let position = start;
  for (;;) {
    const header = await readExactly(handle, position, 4);
    const length = header.readUIntBE(1, 3);
    if ((header[0] & 0x7f) === 6 && length <= MAX_PICTURE_BYTES) {
      const picture = parseFlacPicture(await readExactly(handle, position + 4, length));
      if (picture) pictures.push(picture);
    }
    if (header[0] & 0x80) return pictures;
    position += 4 + length;
    if (position > MAX_TAG_BYTES) throw new Error('FLAC metadata is too large');
  }
}

function removeUnsynchronisation(bytes) {
  const output = [];
  for (let index = 0; index < bytes.length; index += 1) {
    output.push(bytes[index]);
    if (bytes[index] === 0xff && bytes[index + 1] === 0) index += 1;
  }
  return Buffer.from(output);
}

/** Skips the text encoding's terminator (a single or double zero, aligned to the character size). */
function skipTerminated(data, offset, encoding) {
  if (encoding === 0 || encoding === 3) {
    const end = data.indexOf(0, offset);
    if (end < 0) throw new Error('Unterminated ID3 text');
    return end + 1;
  }
  for (let index = offset; index + 1 < data.length; index += 2) {
    if (data[index] === 0 && data[index + 1] === 0) return index + 2;
  }
  throw new Error('Unterminated ID3 text');
}

function id3Picture(data, legacy) {
  const encoding = data[0];
  let offset = 1;
  let mime = 'image/*';
  if (legacy) offset += 3;
  else {
    const end = data.indexOf(0, offset);
    if (end < 0) throw new Error('Unterminated ID3 picture type');
    mime = data.toString('latin1', offset, end);
    offset = end + 1;
  }
  const type = data[offset];
  offset = skipTerminated(data, offset + 1, encoding);
  const image = data.subarray(offset);
  if (mime === '-->' || image.length === 0) return null;
  return { type, data: image };
}

async function id3Pictures(handle, header) {
  const version = header[3];
  if (version < 2 || version > 4) return [];
  const flags = header[5];
  const size = syncsafe(header.subarray(6, 10));
  if (size > MAX_TAG_BYTES) throw new Error('ID3 tag is too large');
  let tag = await readExactly(handle, 10, size);
  if (version < 4 && flags & 0x80) tag = removeUnsynchronisation(tag);
  const legacy = version === 2;
  let offset = 0;
  if (flags & 0x40 && !legacy) offset = version === 3 ? 4 + tag.readUInt32BE(0) : syncsafe(tag.subarray(0, 4));
  const idLength = legacy ? 3 : 4;
  const headerLength = legacy ? 6 : 10;
  const pictures = [];
  while (offset + headerLength <= tag.length && tag[offset] !== 0) {
    const id = tag.toString('latin1', offset, offset + idLength);
    const frameSize = legacy ? tag.readUIntBE(offset + 3, 3)
      : version === 3 ? tag.readUInt32BE(offset + 4) : syncsafe(tag.subarray(offset + 4, offset + 8));
    const bodyStart = offset + headerLength;
    if (frameSize > tag.length - bodyStart) throw new Error('Truncated ID3 frame');
    if (id === 'APIC' || id === 'PIC') {
      let body = tag.subarray(bodyStart, bodyStart + frameSize);
      const frameFlags = legacy ? 0 : tag.readUInt16BE(offset + 8);
      // Compressed or encrypted frames cannot be read without extra machinery.
      const unreadable = version === 3 ? frameFlags & 0xc0 : version === 4 ? frameFlags & 0x0c : 0;
      if (!unreadable) {
        if (version === 3 && frameFlags & 0x20) body = body.subarray(1);
        if (version === 4) {
          if (frameFlags & 0x40) body = body.subarray(1);
          if (frameFlags & 0x01) body = body.subarray(4);
          if (frameFlags & 0x02) body = removeUnsynchronisation(body);
        }
        const picture = id3Picture(body, legacy);
        if (picture) pictures.push(picture);
      }
    }
    offset = bodyStart + frameSize;
  }
  return pictures;
}

async function readPictures(handle) {
  const magic = await readAt(handle, 0, 10);
  if (magic.toString('latin1', 0, 4) === 'OggS') return oggPictures(handle);
  if (magic.toString('latin1', 0, 4) === 'fLaC') return flacPictures(handle, 4);
  if (magic.length === 10 && magic.toString('latin1', 0, 3) === 'ID3') {
    const pictures = await id3Pictures(handle, magic);
    if (pictures.length) return pictures;
    const next = 10 + syncsafe(magic.subarray(6, 10));
    return (await readAt(handle, next, 4)).toString('latin1') === 'fLaC' ? flacPictures(handle, next + 4) : [];
  }
  return [];
}

/**
 * Front-cover (else first) picture embedded in Ogg Opus/Vorbis, FLAC or ID3v2-tagged audio; null when there is none.
 * Reads only the header region. Throws when the metadata is malformed.
 */
export async function extractEmbeddedCover(path) {
  await assertSafePath(path);
  if (!(await lstat(path)).isFile()) throw new Error(`Expected a regular file: ${path}`);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const pictures = await readPictures(handle);
    const chosen = pictures.find((picture) => picture.type === FRONT_COVER) ?? pictures[0];
    return chosen ? chosen.data : null;
  } finally { await handle.close(); }
}
