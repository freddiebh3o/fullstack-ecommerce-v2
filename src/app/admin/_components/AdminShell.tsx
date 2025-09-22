// src/app/admin/_components/AdminShell.tsx
"use client";

import React, { useEffect, useRef, useState } from "react";
import { useTenant } from "../_hooks/useTenant";
import { useTenants } from "../_hooks/useTenants";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AppShell, Burger, Group, Text, NavLink, Button, ScrollArea, ActionIcon, Tooltip,
} from "@mantine/core";
import { signOut } from "next-auth/react";
import {
  IconLayoutDashboard, IconUsers, IconPackage, IconLogout, IconArrowsExchange,
} from "@tabler/icons-react";
import { postJson } from "../_utils/http";
import { notifications } from "@mantine/notifications";
import TenantPickerModal from "./TenantPickerModal";
import { nprogress } from "@mantine/nprogress";

export default function AdminShell({
  children,
}: {
  children: React.ReactNode;
}) {
  // const { isLoading } = useGlobalLoading();
  const [opened, setOpened] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const { tenant, loading: tenantLoading } = useTenant();
  // Fetch tenants once on mount so we can:
  //  - auto-select on first login (exactly 1)
  //  - show/hide "Switch tenant" when there are 2+
  const { tenants, loading: tenantsLoading } = useTenants(true);

  const autoTriedRef = useRef(false);
  

  useEffect(() => {
    console.log('tenant', tenant);
    if (autoTriedRef.current) return;
    if (tenantLoading || tenantsLoading) return;
    if (!tenants) return;

    autoTriedRef.current = true;

    if (tenants.length === 0) {
      notifications.show({
        color: "red",
        title: "No tenant access",
        message:
          "Your account is not a member of any tenant. Please contact an admin.",
        withBorder: true,
      });
      return;
    }

    if (!tenant) {
      if (tenants.length === 1) {
        // First login with exactly one tenant → auto-select
        (async () => {
          try {
            await postJson("/api/tenant/select", { tenantId: tenants[0].id });
            notifications.show({
              color: "green",
              title: "Tenant selected",
              message: `Using ${tenants[0].name}`,
              withBorder: true,
            });
            window.location.reload();
          } catch (e: any) {
            notifications.show({
              color: "red",
              title: "Failed to select tenant",
              message: e?.message ?? "Please try again.",
              withBorder: true,
            });
          }
        })();
      } else if (tenants.length > 1) {
        // First login with multiple tenants → open picker
        setPickerOpen(true);
      }
    }
  }, [tenant, tenantLoading, tenants, tenantsLoading]);

  async function handleSelectTenant(id: string) {
    try {
      await postJson("/api/tenant/select", { tenantId: id });
      notifications.show({
        color: "green",
        title: "Tenant selected",
        message: "Your tenant has been switched.",
      });
      window.location.reload();
    } catch (e: any) {
      notifications.show({
        color: "red",
        title: "Failed to select tenant",
        message: e?.message ?? "Please try again.",
        withBorder: true,
      });
    }
  }

  const pathname = usePathname();
  useEffect(() => {
    const id = setTimeout(() => nprogress.complete(), 120);
    return () => clearTimeout(id);
  }, [pathname]);

  const navItems = [
    { label: "Dashboard", href: "/admin", icon: IconLayoutDashboard },
    { label: "Members", href: "/admin/members", icon: IconUsers },
    { label: "Products", href: "/admin/products", icon: IconPackage },
  ];

  const hasMultipleTenants = (tenants?.length ?? 0) > 1;

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 260, breakpoint: "sm", collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group>
            <Burger
              opened={opened}
              onClick={() => setOpened((o) => !o)}
              hiddenFrom="sm"
              size="sm"
              aria-label="Toggle navigation"
            />
            <Text fw={600}>Admin</Text>
          </Group>

          <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
            {/* Tenant label — show only from sm and up */}
            <Group
              gap={6}
              visibleFrom="sm"
              wrap="nowrap"
              style={{ minWidth: 0 }}
            >
              <Text size="sm" c="dimmed" span>
                Tenant:{" "}
              </Text>
              <Text
                span
                fw={600}
                className="max-w-[32vw] truncate"
                title={tenant?.name ?? undefined}
              >
                {tenantLoading ? "Loading…" : tenant?.name ?? "Not selected"}
              </Text>

              {/* Switch button (desktop only) */}
              {!tenantLoading && hasMultipleTenants && (
                <Button
                  variant="light"
                  size="sm"
                  onClick={() => setPickerOpen(true)}
                >
                  Switch tenant
                </Button>
              )}
            </Group>

            {/* Compact actions — mobile only */}
            <Group gap={6} hiddenFrom="sm">
              {!tenantLoading && hasMultipleTenants && (
                <Tooltip label="Switch tenant">
                  <ActionIcon
                    variant="subtle"
                    onClick={() => setPickerOpen(true)}
                    aria-label="Switch tenant"
                  >
                    <IconArrowsExchange size={18} />
                  </ActionIcon>
                </Tooltip>
              )}

              <Tooltip label="Sign out">
                <ActionIcon
                  variant="subtle"
                  onClick={() => signOut({ callbackUrl: "/login" })}
                  aria-label="Sign out"
                >
                  <IconLogout size={18} />
                </ActionIcon>
              </Tooltip>
            </Group>

            {/* Desktop sign-out button */}
            <Button
              variant="light"
              leftSection={<IconLogout size={16} />}
              onClick={() => signOut({ callbackUrl: "/login" })}
              visibleFrom="sm"
            >
              Sign out
            </Button>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="md">
        <ScrollArea style={{ height: 'calc(100dvh - 56px)' }}>
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <NavLink
                key={item.href}
                component={Link}
                href={item.href}
                label={item.label}
                leftSection={<Icon size={18} />}
                active={active}
                variant="light"
                mb={4}
                onClick={() => {
                  // Optimistically start progress on nav click
                  nprogress.start();
                }}
              />
            );
          })}
        </ScrollArea>
      </AppShell.Navbar>

      <AppShell.Main>
        {children}
      </AppShell.Main>

      {!tenantLoading && (
        <TenantPickerModal
          opened={pickerOpen}
          onClose={() => setPickerOpen(false)}
          tenants={tenants ?? []}
          onSelect={handleSelectTenant}
          currentTenantId={tenant?.id ?? null}
        />
      )}
    </AppShell>
  );
}
