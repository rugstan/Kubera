"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ComponentPropsWithoutRef, ComponentPropsWithRef } from "react";

// Thin shadcn-style wrappers over Radix Dialog. Radix supplies the focus trap,
// Escape handling, scroll lock, aria-hidden on the rest of the page, and focus
// return to the element that opened the dialog.

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogPortal = DialogPrimitive.Portal;
export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;

export function DialogOverlay({ className = "", ...props }: ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>) {
  return <DialogPrimitive.Overlay className={`dialog-overlay fixed inset-0 z-[60] bg-black/30 backdrop-blur-sm ${className}`} {...props} />;
}

/** Close control with a 44x44px minimum hit area (WCAG 2.5.8 and platform guidance). */
export function DialogClose({ className = "", children, ...props }: ComponentPropsWithoutRef<typeof DialogPrimitive.Close>) {
  return (
    <DialogPrimitive.Close className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-full ${className}`} {...props}>
      {children}
    </DialogPrimitive.Close>
  );
}

export function DialogContent({ className = "", children, ...props }: ComponentPropsWithRef<typeof DialogPrimitive.Content>) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        className={`fixed left-1/2 top-[8vh] z-[61] w-[calc(100%-1.5rem)] -translate-x-1/2 focus:outline-none md:top-[12vh] ${className}`}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}
