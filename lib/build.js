import { compareIds } from './ids.js';
import { centroid, unionBox } from './math.js';
import { BvhNode } from './node.js';

/**
 * 确定性自顶向下构建：选择质心跨度最大的轴，稳定排序后中位切分。
 * 相同叶子集合无论调用多少次，产生结构完全一致的树。
 */
export function rebuildTree(leaves) {
  if (leaves.length === 0) return null;
  const ordered = [...leaves].sort((a, b) => compareIds(a.id, b.id));

  const build = (start, end) => {
    if (end - start === 1) {
      const leaf = ordered[start];
      leaf.parent = null;
      leaf.left = null;
      leaf.right = null;
      return leaf;
    }

    let minCx = Infinity;
    let minCy = Infinity;
    let minCz = Infinity;
    let maxCx = -Infinity;
    let maxCy = -Infinity;
    let maxCz = -Infinity;
    for (let i = start; i < end; i++) {
      const c = centroid(ordered[i].bounds);
      if (c.x < minCx) minCx = c.x;
      if (c.y < minCy) minCy = c.y;
      if (c.z < minCz) minCz = c.z;
      if (c.x > maxCx) maxCx = c.x;
      if (c.y > maxCy) maxCy = c.y;
      if (c.z > maxCz) maxCz = c.z;
    }

    const extentX = maxCx - minCx;
    const extentY = maxCy - minCy;
    const extentZ = maxCz - minCz;
    let axis = 'x';
    if (extentY > extentX && extentY >= extentZ) axis = 'y';
    else if (extentZ > extentX && extentZ > extentY) axis = 'z';

    const slice = ordered.slice(start, end);
    slice.sort((a, b) => {
      const ca = centroid(a.bounds)[axis];
      const cb = centroid(b.bounds)[axis];
      if (ca < cb) return -1;
      if (ca > cb) return 1;
      return compareIds(a.id, b.id);
    });
    for (let i = 0; i < slice.length; i++) ordered[start + i] = slice[i];

    const mid = start + Math.floor((end - start) / 2);
    const node = new BvhNode(unionBox(ordered[start].bounds, ordered[end - 1].bounds));
    node.left = build(start, mid);
    node.right = build(mid, end);
    node.left.parent = node;
    node.right.parent = node;
    node.unionChildren();
    return node;
  };

  return build(0, ordered.length);
}

export function internalSurfaceArea(root) {
  if (root === null) return 0;
  let total = 0;
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node.isLeaf) {
      total += node.sa;
      stack.push(node.left, node.right);
    }
  }
  return total;
}
