export const EPSILON = 1e-12;

export function isValidBox(box) {
  return (
    box !== null &&
    typeof box === 'object' &&
    Number.isFinite(box.minX) &&
    Number.isFinite(box.minY) &&
    Number.isFinite(box.minZ) &&
    Number.isFinite(box.maxX) &&
    Number.isFinite(box.maxY) &&
    Number.isFinite(box.maxZ) &&
    box.minX <= box.maxX &&
    box.minY <= box.maxY &&
    box.minZ <= box.maxZ
  );
}

export function copyBox(box) {
  return {
    minX: box.minX,
    minY: box.minY,
    minZ: box.minZ,
    maxX: box.maxX,
    maxY: box.maxY,
    maxZ: box.maxZ,
  };
}

export function unionBox(a, b) {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    minZ: Math.min(a.minZ, b.minZ),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
    maxZ: Math.max(a.maxZ, b.maxZ),
  };
}

export function unionInto(target, box) {
  if (box.minX < target.minX) target.minX = box.minX;
  if (box.minY < target.minY) target.minY = box.minY;
  if (box.minZ < target.minZ) target.minZ = box.minZ;
  if (box.maxX > target.maxX) target.maxX = box.maxX;
  if (box.maxY > target.maxY) target.maxY = box.maxY;
  if (box.maxZ > target.maxZ) target.maxZ = box.maxZ;
  return target;
}

export function containsBox(outer, inner) {
  return (
    outer.minX <= inner.minX &&
    outer.minY <= inner.minY &&
    outer.minZ <= inner.minZ &&
    outer.maxX >= inner.maxX &&
    outer.maxY >= inner.maxY &&
    outer.maxZ >= inner.maxZ
  );
}

export function boxesEqual(a, b) {
  return (
    a.minX === b.minX &&
    a.minY === b.minY &&
    a.minZ === b.minZ &&
    a.maxX === b.maxX &&
    a.maxY === b.maxY &&
    a.maxZ === b.maxZ
  );
}

export function surfaceArea(box) {
  const dx = box.maxX - box.minX;
  const dy = box.maxY - box.minY;
  const dz = box.maxZ - box.minZ;
  return (dx * dy + dy * dz + dz * dx) * 2;
}

export function centroid(box) {
  return {
    x: (box.minX + box.maxX) * 0.5,
    y: (box.minY + box.maxY) * 0.5,
    z: (box.minZ + box.maxZ) * 0.5,
  };
}

/**
 * Slab 射线/AABB 求交。命中时返回近交点参数 t（原点在盒内时为 0），未命中返回 null。
 * 退化包围盒（零厚度轴）按闭合区间处理，因此点/平面/线段 AABB 同样可命中。
 */
export function rayAabb(origin, direction, box) {
  let tMin = -Infinity;
  let tMax = Infinity;

  for (const axis of ['X', 'Y', 'Z']) {
    const o = origin[axis.toLowerCase()];
    const d = direction[axis.toLowerCase()];
    const lo = box[`min${axis}`];
    const hi = box[`max${axis}`];
    if (!Number.isFinite(o)) return null;

    if (d === 0 || !Number.isFinite(d)) {
      if (o < lo || o > hi) return null;
      continue;
    }

    let t1 = (lo - o) / d;
    let t2 = (hi - o) / d;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    if (t1 > tMin) tMin = t1;
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return null;
  }

  if (tMax < 0) return null;
  return tMin > 0 ? tMin : 0;
}
