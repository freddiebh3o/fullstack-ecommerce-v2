// Simple in-memory TTL cache (per process). Not for multi-instance coherence.
type Entry<V> = { v: V; exp: number };

export class TtlCache<K, V> {
  private store = new Map<K, Entry<V>>();
  constructor(private opts: { ttlMs: number; maxSize?: number } ) {}

  get(key: K): V | undefined {
    const e = this.store.get(key);
    if (!e) return undefined;
    if (Date.now() > e.exp) {
      this.store.delete(key);
      return undefined;
    }
    return e.v;
  }

  set(key: K, val: V) {
    if (this.opts.maxSize && this.store.size >= this.opts.maxSize) {
      // naive eviction: delete first key
      const first = this.store.keys().next();
      if (!first.done) this.store.delete(first.value);
    }
    this.store.set(key, { v: val, exp: Date.now() + this.opts.ttlMs });
  }

  delete(key: K) { this.store.delete(key); }
  clear() { this.store.clear(); }
}
