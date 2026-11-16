export { DynamicBvh } from './bvh.js';
export { BvhNode } from './node.js';
export { rebuildTree, internalSurfaceArea } from './build.js';
export {
  isValidBox,
  rayAabb,
  surfaceArea,
  unionBox,
  boxesEqual,
  containsBox,
  centroid,
} from './math.js';

/**
 * 用独立的全量重建树作为参照，验证另一棵树的射线查询结果逐字节一致。
 */
export function referenceTree(objects, options = {}) {
  const tree = new DynamicBvh(options);
  const ids = [...objects.keys()].sort((a, b) =>
    typeof a === 'string' || typeof b === 'string'
      ? String(a).localeCompare(String(b))
      : a - b,
  );
  for (const id of ids) tree.insert(id, objects.get(id));
  tree.rebuild();
  return tree;
}
