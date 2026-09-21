// Violates: no-dangerous-globals (every banned global incl. computed access).
export function bad(x: Record<string, unknown>) {
  console.log(process.env.SECRET);
  const g = globalThis;
  const r = Reflect.get(x, 'k');
  const e = eval('1+1');
  const f = Function('return 1');
  const b = Buffer.from('x');
  const w = new WebSocket('wss://x');
  const meta = import.meta.url;
  const req = require('fs');
  const sneaky = x['process'];
  return { g, r, e, f, b, w, meta, req, sneaky };
}
