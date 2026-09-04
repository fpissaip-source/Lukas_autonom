const t = (n) => new Proxy({ __name: n }, { get: (o, k) => (k === "__name" ? n : String(k)) });
export const approvals = t("approvals");
export const eq = (f, w) => (z) => z[f] === w;
export const gt = (f, w) => (z) => {
  const a = z[f], b = w;
  if (a instanceof Date || b instanceof Date) return new Date(a).getTime() > new Date(b).getTime();
  return a > b;
};
export const and = (...b) => (z) => b.filter(Boolean).every((fn) => fn(z));
export const desc = () => ({});
export const sql = (teile, ...werte) => ({ __minusEins: true });
export const logger = { info(){}, warn(){}, error(){}, debug(){} };

globalThis.__zeilen = [];
let id = 100;
export const db = {
  select: () => ({ from: () => {
    const bau = (bed) => ({
      where: (b) => bau(b),
      orderBy: () => bau(bed),
      limit: async () => globalThis.__zeilen.filter((z) => (bed ? bed(z) : true)),
      then: (r, j) => Promise.resolve(globalThis.__zeilen.filter((z) => (bed ? bed(z) : true))).then(r, j),
    });
    return bau(null);
  } }),
  update: () => ({ set: (werte) => ({ where: (bed) => ({ returning: async () => {
    const treffer = globalThis.__zeilen.filter(bed);
    if (treffer.length === 0) return [];
    const z = treffer[0];
    const vorher = { ...z };
    for (const [k, v] of Object.entries(werte)) {
      z[k] = v && v.__minusEins ? vorher[k] - 1 : v;
    }
    return [{ ...vorher, ...z }];
  } }) }) }),
  insert: () => ({ values: (v) => ({ returning: async () => {
    const z = { id: ++id, createdAt: new Date(), decidedAt: null, geltung: "einmal", verbleibend: 0, ...v };
    globalThis.__zeilen.push(z);
    return [z];
  } }) }) }),
};