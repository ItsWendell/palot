const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_MEDIA_BYTES = 16 * 1024 * 1024;
const MAX_AUDIO_VIDEO_BYTES = 32 * 1024 * 1024;

export type WorkspaceFilePreview =
  | { kind: "image" | "pdf"; mime: string; data: Uint8Array }
  | { kind: "audio" | "video"; mime: string; data: Uint8Array }
  | { kind: "markdown" | "text"; text: string }
  | { kind: "too-large"; limitMiB: number }
  | { kind: "binary" };

/** Only sniff formats we explicitly embed; a filename/MIME hint cannot turn SVG or HTML into media. */
export function classifyWorkspaceFile(path: string, data: Uint8Array): WorkspaceFilePreview {
  const mime = previewMime(data);
  if (mime) {
    if (mime.startsWith("audio/") || mime.startsWith("video/")) {
      if (data.byteLength > MAX_AUDIO_VIDEO_BYTES) return { kind: "too-large", limitMiB: 32 };
      return { kind: mime.startsWith("audio/") ? "audio" : "video", mime, data };
    }
    if (data.byteLength > MAX_MEDIA_BYTES) return { kind: "too-large", limitMiB: 16 };
    return { kind: mime === "application/pdf" ? "pdf" : "image", mime, data };
  }

  if (data.byteLength > MAX_TEXT_BYTES) return { kind: "too-large", limitMiB: 2 };
  if (data.includes(0)) return { kind: "binary" };
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(data);
    return { kind: /\.(?:md|markdown)$/i.test(path) ? "markdown" : "text", text };
  } catch {
    return { kind: "binary" };
  }
}

function previewMime(data: Uint8Array): string | null {
  if (startsWith(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (startsWith(data, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (
    startsWith(data, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
    startsWith(data, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
  ) {
    return "image/gif";
  }
  if (
    startsWith(data, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(data.subarray(8), [0x57, 0x45, 0x42, 0x50])
  ) {
    return "image/webp";
  }
  if (startsWith(data, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  if (isWave(data)) return "audio/wav";
  if (isOggAudio(data)) return "audio/ogg";
  if (isMp3(data)) return "audio/mpeg";
  if (isMp4(data)) return "video/mp4";
  if (isWebM(data)) return "video/webm";
  return null;
}

function isWave(data: Uint8Array): boolean {
  if (!startsWith(data, [0x52, 0x49, 0x46, 0x46]) || !asciiAt(data, 8, "WAVE")) return false;
  const end = readU32LE(data, 4) + 8;
  if (end < 44 || end > data.length) return false;
  let format = false;
  let audio = false;
  for (let offset = 12, chunks = 0; offset + 8 <= end && chunks < 256; chunks++) {
    const size = readU32LE(data, offset + 4);
    const next = offset + 8 + size + (size % 2);
    if (next > end) return false;
    if (asciiAt(data, offset, "fmt ") && size >= 16) format = true;
    if (asciiAt(data, offset, "data") && size > 0) audio = true;
    if (format && audio) return true;
    offset = next;
  }
  return false;
}

function isOggAudio(data: Uint8Array): boolean {
  if (!asciiAt(data, 0, "OggS") || data.length < 28 || data[4] !== 0 || !(data[5]! & 2)) {
    return false;
  }
  const segmentCount = data[26]!;
  if (segmentCount === 0 || data.length < 27 + segmentCount) return false;
  let packetSize = 0;
  for (let i = 0; i < segmentCount; i++) {
    packetSize += data[27 + i]!;
    if (data[27 + i] !== 255) break;
  }
  const packet = 27 + segmentCount;
  if (packet + packetSize > data.length) return false;
  return (
    (asciiAt(data, packet, "OpusHead") && packetSize >= 19) ||
    (data[packet] === 1 && asciiAt(data, packet + 1, "vorbis") && packetSize >= 30)
  );
}

function isMp3(data: Uint8Array): boolean {
  let offset = 0;
  if (asciiAt(data, 0, "ID3")) {
    if (
      data.length < 10 ||
      ![2, 3, 4].includes(data[3]!) ||
      data[4] === 0xff ||
      (data[6]! | data[7]! | data[8]! | data[9]!) & 0x80
    )
      return false;
    const tagSize = ((data[6]! << 21) | (data[7]! << 14) | (data[8]! << 7) | data[9]!) + 10;
    offset = tagSize + (data[3] === 4 && data[5]! & 0x10 ? 10 : 0);
  }
  const first = mp3FrameLength(data, offset);
  if (!first || offset + first > data.length) return false;
  // A second header, when present, guards against arbitrary bytes starting with frame sync.
  const next = offset + first;
  return next + 4 > data.length || Boolean(mp3FrameLength(data, next));
}

function mp3FrameLength(data: Uint8Array, offset: number): number | null {
  if (offset + 4 > data.length || data[offset] !== 0xff) return null;
  // MPEG 1/2/2.5 Layer III only (the browser's broadly supported MP3 bitstreams).
  const header = data[offset + 1]!;
  const version = (header >> 3) & 3;
  if ((header & 0xe0) !== 0xe0 || version === 1 || ((header >> 1) & 3) !== 1) return null;
  const rateIndex = (data[offset + 2]! >> 4) & 15;
  const sampleIndex = (data[offset + 2]! >> 2) & 3;
  if (rateIndex === 0 || rateIndex === 15 || sampleIndex === 3) return null;
  const rates =
    version === 3
      ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
      : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  const samples =
    version === 3
      ? [44100, 48000, 32000]
      : version === 2
        ? [22050, 24000, 16000]
        : [11025, 12000, 8000];
  return (
    Math.floor(((version === 3 ? 144 : 72) * rates[rateIndex]! * 1000) / samples[sampleIndex]!) +
    ((data[offset + 2]! >> 1) & 1)
  );
}

function isMp4(data: Uint8Array): boolean {
  if (data.length < 24 || !asciiAt(data, 4, "ftyp")) return false;
  const size = readU32BE(data, 0);
  if (size < 16 || size > data.length || size % 4 !== 0) return false;
  const brands = ["isom", "iso2", "mp41", "mp42", "avc1", "M4V "];
  if (!brands.some((brand) => asciiAt(data, 8, brand))) return false;
  // The file-type box alone isn't a playable video; require a valid media or movie box.
  for (let offset = size, boxes = 0; offset + 8 <= data.length && boxes < 32; boxes++) {
    const boxSize = readU32BE(data, offset);
    if (boxSize < 8 || offset + boxSize > data.length) return false;
    if (asciiAt(data, offset + 4, "mdat") && boxSize > 8) return true;
    if (asciiAt(data, offset + 4, "moov") && boxSize > 8) return true;
    offset += boxSize;
  }
  return false;
}

function isWebM(data: Uint8Array): boolean {
  if (!startsWith(data, [0x1a, 0x45, 0xdf, 0xa3])) return false;
  const header = readVint(data, 4, true);
  if (!header || header.value > 4096) return false;
  const end = 4 + header.length + header.value;
  if (end > data.length) return false;
  for (let offset = 4 + header.length; offset < end;) {
    const id = readVint(data, offset, false);
    if (!id) return false;
    const size = readVint(data, offset + id.length, true);
    if (!size) return false;
    const value = offset + id.length + size.length;
    if (value + size.value > end) return false;
    if (id.value === 0x4282) {
      const segment = end;
      return (
        size.value === 4 &&
        asciiAt(data, value, "webm") &&
        startsWith(data.subarray(segment), [0x18, 0x53, 0x80, 0x67]) &&
        Boolean(data[segment + 4]) &&
        segment + 6 <= data.length
      );
    }
    offset = value + size.value;
  }
  return false;
}

function readVint(
  data: Uint8Array,
  offset: number,
  stripMarker: boolean,
): { value: number; length: number } | null {
  const first = data[offset];
  if (!first) return null;
  let marker = 0x80;
  let length = 1;
  while (!(first & marker) && length < 8) {
    marker >>= 1;
    length++;
  }
  if (!(first & marker) || offset + length > data.length) return null;
  let value = stripMarker ? first & (marker - 1) : first;
  for (let i = 1; i < length; i++) value = value * 256 + data[offset + i]!;
  return Number.isSafeInteger(value) ? { value, length } : null;
}

function asciiAt(data: Uint8Array, offset: number, value: string): boolean {
  return (
    offset >= 0 &&
    offset + value.length <= data.length &&
    [...value].every((char, i) => data[offset + i] === char.charCodeAt(0))
  );
}

function readU32LE(data: Uint8Array, offset: number): number {
  return (
    data[offset]! +
    data[offset + 1]! * 256 +
    data[offset + 2]! * 65536 +
    data[offset + 3]! * 16777216
  );
}

function readU32BE(data: Uint8Array, offset: number): number {
  return (
    data[offset]! * 16777216 +
    data[offset + 1]! * 65536 +
    data[offset + 2]! * 256 +
    data[offset + 3]!
  );
}

function startsWith(data: Uint8Array, signature: number[]): boolean {
  return (
    data.byteLength >= signature.length && signature.every((byte, index) => data[index] === byte)
  );
}
