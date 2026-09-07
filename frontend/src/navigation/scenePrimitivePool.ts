/** Small renderer-neutral pool for Cesium PrimitiveCollection containers.
 * Pooling the container avoids allocation churn during scene-bubble handoffs;
 * callers remain responsible for removing child primitives/entities.
 */
export interface PrimitiveCollectionLike {
  removeAll?: () => void;
}

export class ScenePrimitivePool<T extends PrimitiveCollectionLike> {
  private readonly pool: T[] = [];
  private readonly maxSize: number;

  constructor(maxSize = 8) { this.maxSize = Math.max(1, maxSize); }

  acquire(factory: () => T): T {
    return this.pool.pop() ?? factory();
  }

  release(collection: T): void {
    try { collection.removeAll?.(); } catch {}
    if (this.pool.length < this.maxSize) this.pool.push(collection);
  }

  clear(): void {
    for (const collection of this.pool) {
      try { collection.removeAll?.(); } catch {}
    }
    this.pool.length = 0;
  }

  get size(): number { return this.pool.length; }
}
