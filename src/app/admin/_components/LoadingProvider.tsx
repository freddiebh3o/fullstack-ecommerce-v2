// src/app/admin/_components/LoadingProvider.tsx
'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { subscribeGlobalLoading } from '../_utils/loadingBus';

type Ctx = { isLoading: boolean; count: number };
const LoadingCtx = createContext<Ctx>({ isLoading: false, count: 0 });

export function useGlobalLoading() {
  return useContext(LoadingCtx);
}

export default function LoadingProvider({ children }: { children: React.ReactNode }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const unsubscribe = subscribeGlobalLoading(setCount);
    return unsubscribe; // cleanup on unmount
  }, []); // subscribe once

  return (
    <LoadingCtx.Provider value={{ isLoading: count > 0, count }}>
      {children}
    </LoadingCtx.Provider>
  );
}
