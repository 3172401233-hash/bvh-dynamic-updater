export function idKey(id) {
  if (typeof id === 'number') return `n:${id}`;
  if (typeof id === 'string') return `s:${id}`;
  throw new TypeError('对象 ID 必须是 number 或 string');
}

export function assertId(id) {
  if (typeof id !== 'number' && typeof id !== 'string') {
    throw new TypeError('对象 ID 必须是 number 或 string');
  }
  if (typeof id === 'number' && !Number.isFinite(id)) {
    throw new TypeError('数字 ID 必须是有限数值');
  }
}

export function compareIds(a, b) {
  const ta = typeof a === 'number' ? 0 : 1;
  const tb = typeof b === 'number' ? 0 : 1;
  if (ta !== tb) return ta - tb;
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
