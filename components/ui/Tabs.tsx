"use client";

import * as TabsPrimitive from "@radix-ui/react-tabs";
import type { ComponentPropsWithoutRef } from "react";

// Radix Tabs gives role=tablist/tab/tabpanel, aria-selected, aria-controls,
// roving tabindex, and Left/Right/Home/End arrow-key navigation.

export const Tabs = TabsPrimitive.Root;
export const TabsList = TabsPrimitive.List;

export function TabsTrigger({ className = "", ...props }: ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>) {
  return <TabsPrimitive.Trigger className={className} {...props} />;
}

export function TabsContent({ className = "", ...props }: ComponentPropsWithoutRef<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={className} {...props} />;
}
