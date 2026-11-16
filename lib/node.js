import { copyBox, surfaceArea, unionBox } from './math.js';

let sequenceCounter = 0;

export class BvhNode {
  constructor(bounds, id = null) {
    this.bounds = bounds;
    this.id = id;
    this.parent = null;
    this.left = null;
    this.right = null;
    this.sequence = sequenceCounter++;
  }

  get isLeaf() {
    return this.id !== null;
  }

  get sa() {
    return surfaceArea(this.bounds);
  }

  setBox(box) {
    this.bounds = copyBox(box);
  }

  unionChildren() {
    this.bounds = unionBox(this.left.bounds, this.right.bounds);
  }
}
