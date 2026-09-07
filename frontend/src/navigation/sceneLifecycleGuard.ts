/** Rejects async scene work that belongs to an older navigation/render generation. */
export class SceneLifecycleGuard {
  private generation = 0;
  private disposed = false;

  begin(): number { this.generation += 1; return this.generation; }
  invalidate(): void { this.generation += 1; }
  dispose(): void { this.disposed = true; this.invalidate(); }
  isCurrent(token: number): boolean { return !this.disposed && token === this.generation; }
  commit<T>(token: number, value: T, apply: (value: T) => void): boolean {
    if (!this.isCurrent(token)) return false;
    apply(value);
    return true;
  }
  get current(): number { return this.generation; }
}
