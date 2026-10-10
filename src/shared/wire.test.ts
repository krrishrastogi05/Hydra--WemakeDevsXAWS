import { describe, expect, it } from 'vitest';
import { pack, unpack } from './wire';

describe('result wire format', () => {
  it('round-trips typed arrays of every size and alignment, nested in plain JSON', () => {
    const value = {
      n: 3, name: 'Jacobpura', nothing: null,
      frames: new Uint16Array([0, 65535, 7]), odd: new Uint8Array([1, 2, 3, 4, 5]),
      cells: new Int32Array([-2, -1, 40000]), depth: new Float32Array([0.5, 1e-7, 123.25]),
      nested: { series: new Float64Array([Math.PI]), list: [{ id: 1, w: new Float32Array(0) }] },
    };
    const buf = pack(value), copy = new Uint8Array(buf);   // a fresh buffer, as fetch() would give
    const back = unpack<typeof value>(copy.buffer);
    expect(back.n).toBe(3);
    expect(back.nothing).toBeNull();
    expect(back.frames).toBeInstanceOf(Uint16Array);
    expect([...back.frames]).toEqual([0, 65535, 7]);
    expect([...back.odd]).toEqual([1, 2, 3, 4, 5]);
    expect([...back.cells]).toEqual([-2, -1, 40000]);
    expect([...back.depth]).toEqual([...value.depth]);
    expect(back.nested.series[0]).toBe(Math.PI);
    expect(back.nested.list[0].w).toBeInstanceOf(Float32Array);
    expect(back.nested.list[0].w.length).toBe(0);
  });
});
