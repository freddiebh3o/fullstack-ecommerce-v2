// src/app/admin/_components/TenantPickerModal.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { Modal, Radio, Stack, Button, Group, Text, ScrollArea, Badge } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import type { LiteTenant } from '../_hooks/useTenants';

type Props = {
  opened: boolean;
  onClose: () => void;
  tenants: LiteTenant[];
  onSelect: (tenantId: string) => Promise<void>;
  currentTenantId?: string | null; // ← allow undefined during load
};

export default function TenantPickerModal({
  opened,
  onClose,
  tenants,
  onSelect,
  currentTenantId,
}: Props) {
  const isMobile = useMediaQuery('(max-width: 40em)');

  const options = useMemo(() => {
    const seen = new Set<string>();
    return (tenants ?? []).filter((t) => {
      if (!t?.id) return false;
      if (seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    });
  }, [tenants]);

  const [value, setValue] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    console.log('currentTenantId', currentTenantId);
  }, [currentTenantId]);

  // Default selection when modal opens, and re-align when currentTenantId becomes available
  useEffect(() => {
    if (!opened) return;
    if (value !== null) return; // ← do not override user choice
  
    if (currentTenantId && options.some((o) => o.id === currentTenantId)) {
      setValue(currentTenantId);
    } else if (options.length > 0) {
      setValue(options[0].id);
    }
  }, [opened, currentTenantId, options, value]);
  
  const isSameAsCurrent = !!value && !!currentTenantId && value === currentTenantId;
  const confirmDisabled = !value || isSameAsCurrent || submitting;

  async function handleConfirm() {
    if (confirmDisabled || !value) return;
    setSubmitting(true);
    try {
      await onSelect(value);
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Select a tenant"
      centered={!isMobile}
      fullScreen={isMobile}
      radius={isMobile ? 0 : 'md'}
      transitionProps={{ transition: 'fade', duration: 150 }}
      size={isMobile ? '100%' : 'md'}
    >
      <Stack gap="md" style={{ minHeight: isMobile ? '60dvh' : undefined }}>
        {options.length === 0 ? (
          <Text c="dimmed" size="sm">No tenants available for your account.</Text>
        ) : (
          <ScrollArea style={{ maxHeight: isMobile ? 'calc(100dvh - 200px)' : 360 }}>
            <Radio.Group value={value} onChange={setValue} name="tenant">
              <Stack gap="xs" p="xs">
                {options.map((t, i) => {
                  const selected = !!currentTenantId && t.id === currentTenantId;
                  return (
                    <div key={`${t.id}-${i}`} className="flex items-center justify-between">
                      <Radio value={t.id} label={t.name} />
                      {selected && <Badge variant="light" size="sm">Current</Badge>}
                    </div>
                  );
                })}
              </Stack>
            </Radio.Group>
          </ScrollArea>
        )}

        <Group justify="flex-end" mt="sm">
          <Button variant="light" onClick={onClose}>Cancel</Button>
          <Button disabled={confirmDisabled} loading={submitting} onClick={handleConfirm}>
            {isSameAsCurrent ? 'Already selected' : 'Use tenant'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
