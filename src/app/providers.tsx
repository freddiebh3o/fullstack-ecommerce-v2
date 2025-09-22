// src/app/providers.tsx
'use client';

import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { NavigationProgress } from '@mantine/nprogress';
import { SessionProvider } from 'next-auth/react';
import React from 'react';

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <MantineProvider defaultColorScheme="auto">
        <NavigationProgress /> 
        <Notifications position="top-right" />
        {children}
      </MantineProvider>
    </SessionProvider>
  );
}