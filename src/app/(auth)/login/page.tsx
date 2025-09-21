// src/app/(auth)/login/page.tsx
'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { signIn } from 'next-auth/react';
import {
  Paper, Title, TextInput, PasswordInput, Button, Stack, Group, Anchor, Text,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';

export default function LoginPage() {
  const router = useRouter();
  const search = useSearchParams();
  const next = search.get('next') || '/admin';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const el = document.getElementById('email') as HTMLInputElement | null;
    el?.focus();
  }, []);

  function mapSignInError(code?: string): string {
    switch (code) {
      case 'CredentialsSignin':
        return 'Invalid email or password.';
      case 'OAuthAccountNotLinked':
        return 'This email is linked to a different sign-in method.';
      case 'AccessDenied':
        return 'Access denied.';
      default:
        return 'Unable to sign in. Please try again.';
    }
  }
  
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
  
    const res = await signIn('credentials', {
      redirect: false,
      callbackUrl: next,
      email,
      password,
    });
  
    setSubmitting(false);
  
    if (!res || res.error) {
      notifications.show({
        color: 'red',
        title: 'Sign in failed',
        message: mapSignInError(res?.error ?? undefined),
        withBorder: true,
      });
      return;
    }
  
    router.push(res.url ?? next);
  }

  return (
    <div className="grid min-h-[100dvh] grid-cols-1 md:grid-cols-2">
      {/* Left: form */}
      <div className="flex items-center justify-center p-6 md:p-10">
        <Paper withBorder p="xl" radius="md" style={{ width: 420, maxWidth: '100%' }}>
          <Title order={3} mb="sm">Sign in</Title>
          <Text size="sm" c="dimmed" mb="lg">
            Use your email and password to access the admin.
          </Text>

          <form onSubmit={onSubmit}>
            <Stack gap="md">
              <TextInput
                id="email"
                label="Email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.currentTarget.value)}
                required
                autoComplete="email"
              />
              <PasswordInput
                label="Password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.currentTarget.value)}
                required
                autoComplete="current-password"
              />

              <Button type="submit" loading={submitting} fullWidth>
                Sign in
              </Button>

              <Group justify="space-between">
                <Anchor size="sm" onClick={() => notifications.show({ message: 'Password reset coming soon.' })}>
                  Forgot password?
                </Anchor>
                <Text size="xs" c="dimmed">v0 — credentials only</Text>
              </Group>
            </Stack>
          </form>
        </Paper>
      </div>

      {/* Right: image */}
      <div className="relative hidden md:block">
        {/* The image file lives at /public/login-hero.jpg */}
        <Image
          src="/login-hero.jpg"
          alt="Welcome back — access your admin dashboard"
          fill
          priority
          sizes="50vw"
          style={{ objectFit: 'cover' }}
        />
        {/* Optional subtle overlay for legibility */}
        <div className="pointer-events-none absolute inset-0 bg-black/20 dark:bg-black/35" />
      </div>
    </div>
  );
}
