import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";

/**
 * The site container, shared by every public page, the header bar and the
 * footer: 1280px at most, centred, with 20px gutters on phones and 32px from
 * md. Pages put their header and main sections in it, and keep long text
 * readable inside it with `READABLE` or a multi-column grid rather than a
 * narrower page.
 */
export const PAGE_CONTAINER = "mx-auto w-full max-w-[1280px] px-5 md:px-8";

/** Line length for running text inside the container: about 70 characters. */
export const READABLE = "max-w-[70ch]";

/**
 * Main column and side column for pages with a sidebar, from lg: about two
 * thirds and one third. Children place themselves with `MAIN_COLUMN` and
 * `SIDE_COLUMN`, so the side column can come first in the DOM (and on a
 * phone) and still sit on the right on a desktop.
 */
export const SIDEBAR_GRID = "grid gap-y-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:gap-x-12 xl:gap-x-16";
export const MAIN_COLUMN = "min-w-0 lg:col-start-1 lg:row-start-1";
export const SIDE_COLUMN = "min-w-0 lg:col-start-2 lg:row-start-1";

type PageContainerProps<T extends ElementType> = {
  as?: T;
  className?: string;
  children?: ReactNode;
} & Omit<ComponentPropsWithoutRef<T>, "as" | "className" | "children">;

/**
 * A block in the site container. `data-page-container` marks it for
 * e2e/layout-width.spec.ts, which checks every public page's content spans
 * the container on a desktop.
 */
export function PageContainer<T extends ElementType = "div">({ as, className, children, ...rest }: PageContainerProps<T>) {
  const Tag: ElementType = as ?? "div";
  return (
    <Tag data-page-container="" className={className ? `${PAGE_CONTAINER} ${className}` : PAGE_CONTAINER} {...rest}>
      {children}
    </Tag>
  );
}
