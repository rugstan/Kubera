import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FormProvider, useForm, type FieldValues } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";
import { CheckboxField, ChipsField, ChoiceField, NumericField, SelectField, TextField } from "./Field";
import { ErrorSummary, Stepper, flattenErrors } from "./Form";
import { controlAria, describedBy, fieldId, fieldIds, formatNumeric, parseNumeric } from "./ids";
import { friendlyIssueMessage, leafOfPath, mapServerFailure, networkFailure } from "./server-errors";
import { postJson } from "./submit";

describe("ids", () => {
  it("derives stable ids from a field name", () => {
    expect(fieldId("contact.email")).toBe("f-contact-email");
    expect(fieldIds("email")).toEqual({ id: "f-email", hintId: "f-email-hint", errorId: "f-email-error" });
  });

  it("joins only the ids that exist", () => {
    expect(describedBy("a", false, undefined, "b")).toBe("a b");
    expect(describedBy(false, null)).toBeUndefined();
  });

  it("marks invalid, described and required controls", () => {
    expect(controlAria({ name: "email", hasHint: true, error: "Enter an email.", required: true })).toEqual({
      id: "f-email",
      "aria-invalid": true,
      "aria-describedby": "f-email-hint f-email-error",
      "aria-required": true,
    });
    expect(controlAria({ name: "email" })).toEqual({ id: "f-email", "aria-invalid": undefined, "aria-describedby": undefined, "aria-required": undefined });
  });

  it("parses typed numbers tolerantly and formats them for display", () => {
    expect(parseNumeric("$3,000,000")).toBe(3_000_000);
    expect(parseNumeric("88.5")).toBe(88.5);
    expect(parseNumeric("12.9", { integer: true })).toBe(12);
    expect(parseNumeric("")).toBeNull();
    expect(parseNumeric("abc")).toBeNull();
    expect(parseNumeric(".")).toBeNull();
    expect(formatNumeric(3_000_000, "money")).toBe("3,000,000");
    expect(formatNumeric(null, "money")).toBe("");
    expect(formatNumeric(1.25, "decimal")).toBe("1.25");
  });
});

describe("server error mapping", () => {
  const fields = ["email", "loanAmount", "firstName"];

  it("puts server field issues on the matching fields", () => {
    const f = mapServerFailure(400, { error: "Invalid submission", issues: [{ path: "contact.email", message: "Invalid email address" }, { path: "intake.loanAmount", message: "Minimum $250,000" }] }, { fields });
    expect(f.kind).toBe("validation");
    expect(f.fieldErrors).toEqual({ email: "Enter a valid email address.", loanAmount: "Minimum $250,000." });
    expect(f.message).toMatch(/highlighted fields/i);
  });

  it("names issues that have no field on this form instead of dropping them", () => {
    const f = mapServerFailure(400, { issues: [{ path: "intake.timelineDays", message: "Too big: expected number to be <=730" }] }, { fields, labels: { timelineDays: "Timeline" } });
    expect(f.fieldErrors).toEqual({});
    expect(f.message).toContain("Timeline: Check this entry.");
  });

  it("explains rate limits, verification failures and server errors in plain language", () => {
    expect(mapServerFailure(429, { error: "Too many submissions. Please call us directly." }).message).toMatch(/too many submissions.*email deals@/i);
    expect(mapServerFailure(403, { error: "Verification failed. Please refresh the page and try again." }).kind).toBe("verification");
    expect(mapServerFailure(403, null).message).toMatch(/refresh the page/i);
    expect(mapServerFailure(413, null).kind).toBe("too_large");
    const s = mapServerFailure(500, { error: "boom: stack trace" });
    expect(s.kind).toBe("server");
    expect(s.message).not.toContain("boom");
    expect(networkFailure().message).toMatch(/connection/i);
  });

  it("uses the supplied contact address", () => {
    expect(mapServerFailure(500, null, { contactEmail: "partners@kuberacommercial.com" }).message).toContain("partners@kuberacommercial.com");
  });

  it("reduces zod paths to field names and softens developer messages", () => {
    expect(leafOfPath("contact.email")).toBe("email");
    expect(leafOfPath("services.0")).toBe("services");
    expect(leafOfPath("")).toBe("");
    expect(friendlyIssueMessage("Invalid input: expected number, received undefined")).toBe("Check this entry.");
    expect(friendlyIssueMessage("Enter a name")).toBe("Enter a name.");
  });
});

describe("postJson", () => {
  const ok = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;

  it("sends JSON with the content type the API requires and returns the body", async () => {
    const fetchImpl = ok({ ok: true });
    const r = await postJson("/api/x", { a: 1 }, { fetchImpl, headers: { "x-test": "1" } });
    expect(r).toEqual({ ok: true, data: { ok: true } });
    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(init.headers).toMatchObject({ "content-type": "application/json", "x-test": "1" });
    expect(init.body).toBe('{"a":1}');
  });

  it("maps an error response", async () => {
    const r = await postJson("/api/x", {}, { fetchImpl: ok({ error: "Too many submissions." }, 429) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.kind).toBe("rate_limit");
  });

  it("survives a non-JSON error body and a network failure", async () => {
    const html = vi.fn(async () => new Response("<html>bad gateway</html>", { status: 502 })) as unknown as typeof fetch;
    const r1 = await postJson("/api/x", {}, { fetchImpl: html });
    expect(r1.ok === false && r1.failure.kind).toBe("server");
    const down = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    const r2 = await postJson("/api/x", {}, { fetchImpl: down });
    expect(r2.ok === false && r2.failure.kind).toBe("network");
  });
});

describe("flattenErrors", () => {
  it("lists leaf errors with their field names", () => {
    const errors = {
      email: { type: "custom", message: "Enter an email.", ref: {} },
      nested: { phone: { type: "custom", message: "Bad phone.", ref: {} } },
    };
    expect(flattenErrors(errors as never)).toEqual([
      { name: "email", message: "Enter an email." },
      { name: "nested.phone", message: "Bad phone." },
    ]);
  });
});

function Harness({ children }: { children: React.ReactNode }) {
  const form = useForm<FieldValues>({ defaultValues: { name: "", amount: null, kind: "", pick: "", tags: [], agree: false } });
  return createElement(FormProvider<FieldValues>, form as never, children);
}

const render = (...children: React.ReactNode[]) => renderToStaticMarkup(createElement(Harness, null, ...children));

describe("field markup", () => {
  it("labels a required text field and ties label, input and required state together", () => {
    const html = render(createElement(TextField, { name: "name", label: "First name", required: true, hint: "As on your ID", autoComplete: "given-name" }));
    expect(html).toContain('<label for="f-name" class="field-label">First name');
    expect(html).toContain('id="f-name"');
    expect(html).toContain('aria-required="true"');
    expect(html).toContain('aria-describedby="f-name-hint"');
    expect(html).toContain('id="f-name-hint"');
    expect(html).toContain('autoComplete="given-name"');
    expect(html).not.toContain("aria-invalid");
  });

  it("shows a money field with placeholder and no demo value", () => {
    const html = render(createElement(NumericField, { name: "amount", label: "Loan amount", format: "money", placeholder: "e.g. 3,000,000", required: true }));
    expect(html).toContain('placeholder="e.g. 3,000,000"');
    expect(html).toContain('value=""');
    expect(html).toContain('inputMode="numeric"');
  });

  it("renders a select with a disabled placeholder option selected", () => {
    const html = render(createElement(SelectField, { name: "kind", label: "Type", options: [{ value: "A", label: "Alpha" }], placeholder: "Select a type" }));
    expect(html).toContain('<option value="" disabled="" selected="">Select a type</option>');
    expect(html).toContain("Alpha");
  });

  it("renders a labelled radio group and a checkbox group with native inputs", () => {
    const radios = render(createElement(ChoiceField, { name: "pick", label: "Owner-operator?", required: true, options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] }));
    expect(radios).toContain('role="radiogroup"');
    expect(radios).toContain('aria-required="true"');
    expect(radios.match(/type="radio"/g)).toHaveLength(2);
    expect(radios).not.toContain("checked=");
    const chips = render(createElement(ChipsField, { name: "tags", label: "Services", required: true, options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] }));
    expect(chips).toContain("<legend");
    expect(chips.match(/type="checkbox"/g)).toHaveLength(2);
  });

  it("renders a checkbox with its label wrapping the text and a required mark that is hidden from screen readers", () => {
    const html = render(createElement(CheckboxField, { name: "agree", label: "I agree", required: true }));
    expect(html).toContain('for="f-agree"');
    expect(html).toContain('aria-required="true"');
    expect(html).toContain('aria-hidden="true"');
  });
});

describe("Stepper", () => {
  it("marks exactly the current step with aria-current", () => {
    const html = renderToStaticMarkup(createElement(Stepper, { steps: ["Asset", "Deal", "Terms", "Contact"], current: 1 }));
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    expect(html).toContain("(step 2 of 4, current)");
    expect(html).toContain("(step 1 of 4, completed)");
    expect(html).toContain("(step 4 of 4, upcoming)");
  });
});

describe("ErrorSummary", () => {
  it("renders nothing until a submit has failed", () => {
    function H() {
      const form = useForm<FieldValues>();
      return createElement(FormProvider<FieldValues>, form as never, createElement(ErrorSummary, { labels: {}, focusSignal: 0 }));
    }
    expect(renderToStaticMarkup(createElement(H))).toBe("");
  });
});
