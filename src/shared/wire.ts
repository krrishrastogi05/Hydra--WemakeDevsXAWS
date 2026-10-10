// Binary format for engine results sent by the API (backend/src/calc.ts) to the browser. A storm result is mostly
// typed arrays (water depth in every cell for every frame, several MB); as JSON those would become long number lists,
// so they travel as raw bytes behind a small JSON header:
//   [header length, u32 LE][header JSON, UTF-8][padding to 8 bytes][each array's bytes, padded to 8 bytes]
// In the header every typed array is replaced by { $array: type, offset, length }. Used by Node and the browser.
const TYPES = { Uint8Array, Uint16Array, Int32Array, Float32Array, Float64Array };
type TypeName = keyof typeof TYPES;
const pad8 = (n: number) => Math.ceil(n / 8) * 8;

export function pack(value: unknown): Uint8Array {
  const arrays: ArrayBufferView[] = [];
  let size = 0;
  const header = JSON.stringify(value, (_k, v: unknown) => {
    if (!ArrayBuffer.isView(v)) return v;
    const type = v.constructor.name;
    if (!(type in TYPES)) throw new Error(`Cannot pack a ${type}`);
    const ref = { $array: type, offset: size, length: (v as Uint8Array).length };
    arrays.push(v);
    size += pad8(v.byteLength);
    return ref;
  });
  const head = new TextEncoder().encode(header), start = pad8(4 + head.length), out = new Uint8Array(start + size);
  new DataView(out.buffer).setUint32(0, head.length, true);
  out.set(head, 4);
  let at = start;
  for (const a of arrays) { out.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), at); at += pad8(a.byteLength); }
  return out;
}

export function unpack<T>(buf: ArrayBuffer): T {
  const len = new DataView(buf).getUint32(0, true), start = pad8(4 + len);
  const header = new TextDecoder().decode(new Uint8Array(buf, 4, len));
  return JSON.parse(header, (_k, v) => (v && typeof v === 'object' && typeof v.$array === 'string' && v.$array in TYPES
    ? new TYPES[v.$array as TypeName](buf, start + v.offset, v.length)
    : v)) as T;
}
