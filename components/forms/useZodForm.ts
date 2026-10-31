"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, type DefaultValues, type FieldValues, type Resolver, type UseFormReturn } from "react-hook-form";
import type { ZodType } from "zod";

export type SchemaSource<V> = ZodType | ((values: V) => ZodType);

/**
 * react-hook-form wired to a Zod schema. The schema can be a function of the
 * current values, so a form whose rules depend on an earlier answer (hotel
 * fields only for hotels, services only for vendors) validates exactly the
 * fields that are on screen.
 *
 * `focusError` moves focus to the first invalid control on a failed submit or a
 * failed `trigger()`. Turn it off when an error summary takes focus instead.
 */
export function useZodForm<V extends FieldValues>(opts: { schema: SchemaSource<V>; defaultValues: DefaultValues<V>; focusError?: boolean }): UseFormReturn<V> {
  // react-hook-form keeps the options of the latest render, so a fresh closure each render always sees the current schema source.
  const resolver = ((values, context, options) => {
    const schema = typeof opts.schema === "function" ? opts.schema(values as V) : opts.schema;
    return (zodResolver(schema as never) as unknown as Resolver<V>)(values, context, options);
  }) as Resolver<V>;

  return useForm<V>({
    resolver,
    defaultValues: opts.defaultValues,
    mode: "onTouched",
    reValidateMode: "onChange",
    shouldFocusError: opts.focusError ?? true,
  });
}
