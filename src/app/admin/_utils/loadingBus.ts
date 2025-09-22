// src/app/admin/_utils/loadingBus.ts
'use client';

type Listener = (count: number) => void;

let count = 0;
const listeners = new Set<Listener>();

export function startGlobalLoading() {
    console.log('startGlobalLoading', count);
  count += 1;
  for (const l of listeners) l(count);
}

export function stopGlobalLoading() {
  count = Math.max(0, count - 1);
  for (const l of listeners) l(count);
}

export function subscribeGlobalLoading(listener: Listener) {
  listeners.add(listener);
  // push current value immediately
  listener(count);
  return () => {
    // return void, not boolean
    listeners.delete(listener);
  };
}
