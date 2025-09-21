// src/app/providers.tsx
'use client';

import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { SessionProvider } from 'next-auth/react';
import React from 'react';

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <MantineProvider defaultColorScheme="auto">
        <Notifications position="top-right" />
        {children}
      </MantineProvider>
    </SessionProvider>
  );
}
