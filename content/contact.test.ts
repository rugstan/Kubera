import { describe, expect, it } from "vitest";
import { CALL_LINK } from "@/components/site/nav";
import { MAILBOXES, callLink, calcomHandle, calcomUrls, contactDetails, mailboxAddress, telHref } from "./contact";

describe("mailbox routing table", () => {
  it("lists the five public mailboxes", () => {
    expect(MAILBOXES.map((m) => m.local)).toEqual(["deals", "lenders", "partners", "vendors", "compliance"]);
    expect(mailboxAddress("deals")).toBe("deals@corincommercial.com");
  });

  it("does not publish internal or no-sync mailboxes", () => {
    const all = MAILBOXES.flatMap((m) => [m.local, ...(m.aliases ?? [])]);
    for (const internal of ["docs", "admin", "dmarc", "notifications", "updates"]) expect(all).not.toContain(internal);
  });

  it("routes the group aliases to the right mailbox", () => {
    expect(MAILBOXES.find((m) => m.local === "deals")?.aliases).toEqual(["hello", "info"]);
    expect(MAILBOXES.find((m) => m.local === "compliance")?.aliases).toEqual(["privacy"]);
  });

  it("describes every mailbox", () => {
    for (const m of MAILBOXES) {
      expect(m.audience.length).toBeGreaterThan(5);
      expect(m.useFor.length).toBeGreaterThan(5);
    }
  });
});

describe("calcomHandle", () => {
  it.each([
    [{ NEXT_PUBLIC_CALCOM_LINK: "corin/intro" }, "corin/intro"],
    [{ NEXT_PUBLIC_CALCOM_LINK: " /corin/intro/ " }, "corin/intro"],
    [{ NEXT_PUBLIC_CALCOM_LINK: "corin" }, "corin"],
    [{ NEXT_PUBLIC_CALCOM_LINK: "team/corin/intro" }, "team/corin/intro"],
  ])("%j -> %s", (env, expected) => expect(calcomHandle(env)).toBe(expected));

  it.each([
    {},
    { NEXT_PUBLIC_CALCOM_LINK: "" },
    { NEXT_PUBLIC_CALCOM_LINK: "https://cal.com/corin" },
    { NEXT_PUBLIC_CALCOM_LINK: "corin/../admin" },
    { NEXT_PUBLIC_CALCOM_LINK: "a/b/c/d" },
    { NEXT_PUBLIC_CALCOM_LINK: "corin intro" },
    { NEXT_PUBLIC_CALCOM_LINK: "corin?x=1" },
  ])("%j -> null", (env) => expect(calcomHandle(env)).toBeNull());

  it("builds page and embed urls on cal.com", () => {
    expect(calcomUrls("corin/intro")).toEqual({
      page: "https://cal.com/corin/intro",
      embed: "https://cal.com/corin/intro?embed=true&layout=month_view",
    });
  });
});

describe("contactDetails", () => {
  it("reads phone and address from env", () => {
    const d = contactDetails({ NEXT_PUBLIC_CONTACT_PHONE: "(415) 555-0100", NEXT_PUBLIC_OFFICE_ADDRESS: "1 Market St, San Francisco, CA" });
    expect(d.phone).toBe("(415) 555-0100");
    expect(d.telHref).toBe("4155550100");
    expect(d.address).toBe("1 Market St, San Francisco, CA");
  });

  it("degrades to empty values when nothing is configured", () => {
    const d = contactDetails({});
    expect(d.phone).toBe("");
    expect(d.telHref).toBe("");
    expect(d.scheduling).toBeNull();
    expect(d.email).toContain("@");
  });

  it("enables scheduling only for a valid handle", () => {
    expect(contactDetails({ NEXT_PUBLIC_CALCOM_LINK: "corin/intro" }).scheduling?.page).toBe("https://cal.com/corin/intro");
    expect(contactDetails({ NEXT_PUBLIC_CALCOM_LINK: "javascript:alert(1)" }).scheduling).toBeNull();
  });
});

describe("callLink", () => {
  it("offers Book a call only once a valid scheduling handle is set", () => {
    expect(callLink({ NEXT_PUBLIC_CALCOM_LINK: "corin/intro" })).toEqual({ ...CALL_LINK, kind: "book" });
    expect(CALL_LINK).toEqual({ href: "/contact#schedule", label: "Book a call" });
  });

  it.each([{}, { NEXT_PUBLIC_CALCOM_LINK: "" }, { NEXT_PUBLIC_CALCOM_LINK: "https://cal.com/corin" }])(
    "falls back to Email an advisor without one (%j), never a page that cannot book",
    (env) => {
      const link = callLink(env);
      expect(link).toMatchObject({ label: "Email an advisor", kind: "email" });
      expect(link.href).toMatch(/^mailto:\S+@\S+$/);
    },
  );
});

describe("telHref", () => {
  it.each([
    ["+1 (415) 555-0100", "+14155550100"],
    ["415.555.0100", "4155550100"],
    ["555", ""],
    ["", ""],
  ])("%j -> %j", (input, expected) => expect(telHref(input)).toBe(expected));
});
