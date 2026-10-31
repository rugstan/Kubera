"use client";

import { useCallback, useState } from "react";
import { parseNumber } from "@/lib/calculators/format";

/** Text state for a set of numeric inputs, plus which fields the person has touched. */
export function useFields<K extends string>(initial: Record<K, string>) {
  const [values, setValues] = useState<Record<K, string>>(initial);
  const [touched, setTouched] = useState<Partial<Record<K, boolean>>>({});

  const set = useCallback((key: K, next: string) => setValues((v) => ({ ...v, [key]: next })), []);
  const touch = useCallback((key: K) => setTouched((t) => ({ ...t, [key]: true })), []);
  const fill = useCallback((next: Record<K, string>) => {
    setValues(next);
    setTouched({});
  }, []);

  /** An error is shown once the field has text in it or has been left. */
  const shouldShow = (key: K) => Boolean(touched[key]) || values[key].trim() !== "";
  /** Missing numbers parse to NaN so the pure validators report them. */
  const num = (key: K): number => parseNumber(values[key]) ?? Number.NaN;
  /** Optional numbers: undefined when blank, NaN when junk. */
  const optionalNum = (key: K): number | undefined => (values[key].trim() === "" ? undefined : (parseNumber(values[key]) ?? Number.NaN));

  return { values, set, touch, fill, shouldShow, num, optionalNum };
}
