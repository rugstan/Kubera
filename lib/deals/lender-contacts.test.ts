// Lender contact info and contact validation (lib/deals/lender-contacts.ts):
// cleaning, the restricted-text scan, the regexes the database checks share,
// the derived submission recipient and the phone display helpers.
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import {
  E164_RE,
  EMAIL_DB_RE,
  EXT_RE,
  HTTPS_DB_RE,
  LenderDirectoryError,
  NMLS_RE,
  PORTAL_DB_RE,
  POSTAL_RE,
  STATE_RE,
  US_ZIP_RE,
  cleanText,
  deriveLenderContacts,
  formatPhone,
  lenderContactInfoSchema,
  nmlsId,
  optEmail,
  optExt,
  optHttpsUrl,
  optLine,
  optPhone,
  optPostal,
  optState,
  parseLenderContact,
  parseLenderContactInfo,
  restrictedTextMessage,
  telHref,
} from "./lender-contacts";

/** The error message zod (or the restricted-text scan) gives, or null when the value is accepted. */
function problem(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (err) {
    if (err instanceof ZodError) return err.issues.map((i) => i.message).join("; ");
    if (err instanceof LenderDirectoryError) return err.message;
    throw err;
  }
}

describe("cleaning", () => {
  it("turns blanks into null, trims, normalizes to NFC and drops bidi and zero-width characters", () => {
    expect(optLine(20).parse("")).toBeNull();
    expect(optLine(20).parse("   ")).toBeNull();
    expect(optLine(20).parse(undefined)).toBeNull();
    expect(optLine(20).parse("​")).toBeNull();
    expect(optLine(20).parse("  Dana  ")).toBe("Dana");
    expect(optLine(20).parse("‮evil")).toBe("evil");
    expect(optLine(20).parse("José")).toBe("José");
    expect(cleanText("a⁦b⁩c﻿")).toBe("abc");
    expect(cleanText("line one\r\nline two\rthree", { multiline: true })).toBe("line one\nline two\nthree");
  });

  it("refuses control characters and line breaks in single-line fields without echoing the input", () => {
    for (const bad of ["Dana\nLee", "Dana\rLee", "Dana\u0007", "x\u007Fy", "tab\there"]) {
      const msg = problem(() => optLine(80).parse(bad));
      expect(msg).toBe("Remove line breaks and control characters");
      expect(msg).not.toContain("Dana");
    }
    expect(problem(() => parseLenderContactInfo({ submissionInstructions: "Step 1\nStep 2\tthen 3" }))).toBeNull();
    expect(problem(() => parseLenderContactInfo({ submissionInstructions: "bell\u0007" }))).toMatch(/control characters/);
  });
});

describe("email", () => {
  it("lowercases and refuses header injection, display names, lists and bare hosts", () => {
    expect(optEmail.parse("  Pat@Lender.Example ")).toBe("pat@lender.example");
    for (const bad of ["a@b.c\r\nBcc: x@y.z", "Name <a@b.com>", "a,b@c.com", "a@b", "two words@x.com", "a;b@x.com"]) expect(problem(() => optEmail.parse(bad)), bad).not.toBeNull();
  });

  it("caps the local part at 64 and the address at 254 characters", () => {
    expect(problem(() => optEmail.parse(`${"a".repeat(64)}@x.example`))).toBeNull();
    expect(problem(() => optEmail.parse(`${"a".repeat(65)}@x.example`))).not.toBeNull();
    expect(problem(() => optEmail.parse(`a@${"b".repeat(250)}.com`))).not.toBeNull();
  });
});

describe("phone", () => {
  it("stores E.164 and refuses extensions in the number and words", () => {
    expect(optPhone.parse("(310) 555-0100")).toBe("+13105550100");
    expect(optPhone.parse("+44 20 7946 0000")).toBe("+442079460000");
    expect(optPhone.parse("424.346.6100")).toBe("+14243466100");
    for (const bad of ["310-555-0100 x12", "call me", "555-0100", "+0 123 456 7890"]) expect(problem(() => optPhone.parse(bad)), bad).toMatch(/Enter a phone number like/);
  });

  it("refuses an extension without a phone (lender and contact)", () => {
    expect(problem(() => parseLenderContactInfo({ mainPhoneExt: "12" }))).toMatch(/extension needs a main phone/);
    expect(parseLenderContactInfo({ mainPhone: "3105550100", mainPhoneExt: "12" })).toMatchObject({ mainPhone: "+13105550100", mainPhoneExt: "12" });
    expect(problem(() => parseLenderContact({ fullName: "Dana Lee", phoneExt: "12" }))).toMatch(/extension needs a direct phone/);
    expect(problem(() => optExt.parse("12a"))).not.toBeNull();
  });
});

describe("urls", () => {
  it("refuses anything but plain https and strips query and fragment", () => {
    const site = optHttpsUrl();
    const portal = optHttpsUrl({ portal: true });
    for (const bad of ["http://x.com", "javascript:alert(1)", "data:text/html,x", "https://user:pw@x.com", "https://x.com:8443/", "https://localhost/", "not a url", "ftp://x.com"]) {
      expect(problem(() => site.parse(bad)), bad).not.toBeNull();
      expect(problem(() => portal.parse(bad)), bad).not.toBeNull();
    }
    expect(portal.parse("https://portal.x.com/login?token=abc#f")).toBe("https://portal.x.com/login");
    expect(site.parse("https://Bank.Example/lending?utm=1")).toBe("https://bank.example/lending");
    expect(site.parse("https://x.com")).toBe("https://x.com/");
    expect(problem(() => site.parse(`https://x.com/${"a".repeat(2050)}`))).not.toBeNull();
  });
});

describe("address and ids", () => {
  it("checks US ZIP codes, other postal codes and two-letter states", () => {
    expect(problem(() => parseLenderContactInfo({ postalCode: "9021" }))).toMatch(/ZIP/);
    expect(parseLenderContactInfo({ postalCode: "90210-1234" }).postalCode).toBe("90210-1234");
    expect(parseLenderContactInfo({ postalCode: "sw1a 1aa", country: "gb" })).toMatchObject({ postalCode: "SW1A 1AA", country: "GB" });
    expect(parseLenderContactInfo({}).country).toBe("US");
    expect(optState.parse("ca")).toBe("CA");
    for (const bad of ["Cal", "C", "C1"]) expect(problem(() => optState.parse(bad)), bad).not.toBeNull();
    expect(problem(() => nmlsId.parse("12345678901"))).not.toBeNull();
    expect(nmlsId.parse("1234")).toBe("1234");
  });
});

describe("restricted text", () => {
  const msg = restrictedTextMessage("Submission instructions");
  it("refuses routing, account and card numbers and passwords with a fixed message", () => {
    for (const bad of ["Wire to Routing 121000358", "Our acct # 12345678 at the lender", "Card 4111 1111 1111 1111 on file", "Portal password: hunter2", "pin=1234"]) {
      const m = problem(() => parseLenderContactInfo({ submissionInstructions: bad }));
      expect(m, bad).toBe(msg);
      expect(m).not.toContain("hunter2");
    }
    expect(problem(() => parseLenderContactInfo({ credentialsLocation: "password: hunter2" }))).toBe(restrictedTextMessage("Where the portal password is kept"));
    expect(problem(() => parseLenderContact({ fullName: "Dana Lee", notes: "pwd: x" }))).toBe(restrictedTextMessage("Notes"));
    expect(problem(() => parseLenderContact({ fullName: "Dana Lee", territory: "SSN 123-45-6789" }))).toBe(restrictedTextMessage("Territory"));
  });

  it("accepts a normal phone number or loan amount in the instructions", () => {
    expect(problem(() => parseLenderContactInfo({ submissionInstructions: "Call (310) 555-0100 before sending loans over $2,500,000 to the scenario desk." }))).toBeNull();
    expect(problem(() => parseLenderContactInfo({ credentialsLocation: "1Password › Lenders › Arixa" }))).toBeNull();
  });
});

describe("contact schema", () => {
  it("needs a value for the preferred channel, refuses directory imports from forms and defaults the role", () => {
    expect(problem(() => parseLenderContact({ fullName: "Dana Lee", preferredChannel: "mobile" }))).toMatch(/preferred channel/);
    expect(parseLenderContact({ fullName: "Dana Lee", preferredChannel: "mobile", phoneMobile: "310 555 0199" })).toMatchObject({ preferredChannel: "mobile", phoneMobile: "+13105550199" });
    expect(problem(() => parseLenderContact({ fullName: "Dana Lee", source: "directory_import" }))).toMatch(/Directory imports/);
    expect(parseLenderContact({ fullName: "Dana Lee", role: "" })).toMatchObject({ role: "other", source: "staff", email: null, preferredChannel: null });
    expect(problem(() => parseLenderContact({ fullName: "x".repeat(121) }))).not.toBeNull();
    expect(problem(() => parseLenderContact({ fullName: "  " }))).toMatch(/Required/);
    expect(problem(() => parseLenderContact({ fullName: "Dana", role: "boss" }))).not.toBeNull();
  });
});

describe("TS and database regexes agree", () => {
  // Anything zod accepts must also pass the matching database CHECK (the *_DB_RE twins).
  const samples: { name: string; parse: (v: string) => unknown; db: RegExp; values: string[] }[] = [
    {
      name: "email",
      parse: (v) => optEmail.parse(v),
      db: EMAIL_DB_RE,
      values: [
        "a@b.co", "Pat@Lender.example", "first.last+tag@sub.domain.example", "x@y.z", "a@b", "a b@c.com", "a,b@c.com", "<a@b.com>", "a@b.c\r\n", "\"q\"@x.com",
        "a;b@x.com", "user@xn--bcher-kva.example", "u@x..com", ".a@x.com", "a.@x.com", "a@-x.com", "a@x-.com", "a@x.com.", "@x.com", "a@",
        "UPPER@CASE.COM", "o'brien@x.ie", "a_b@x.io", "a-b@x.io", "1@2.34", "a@b.c\t", "ü@x.de", "a@ü.de", "a@x.c0m", `${"a".repeat(64)}@x.example`,
      ],
    },
    {
      name: "phone",
      parse: (v) => optPhone.parse(v),
      db: E164_RE,
      values: [
        "(310) 555-0100", "310-555-0100", "310.555.0100", "3105550100", "+1 310 555 0100", "1 310 555 0100", "+44 20 7946 0000", "+33 1 23 45 67 89", "+81 3-1234-5678", "+0 310 555 0100",
        "555-0100", "call me", "310-555-0100 x12", "+1", "+123", "12345678", "+12345678", "+123456789012345", "+1234567890123456", "(310)5550100",
        "310 555 01000", "+1 (310) 555-0100", "++13105550100", "+1-310-555-0100", "0044 20 7946 0000", "310/555/0100", "310_555_0100", "+49 30 123456", "+61 2 9876 5432", "+1 800 555 0199",
      ],
    },
    {
      name: "extension",
      parse: (v) => optExt.parse(v),
      db: EXT_RE,
      values: ["1", "12", "123", "1234", "12345", "123456", "1234567", "a", "1a", "-1", "1.5", " 12 ", "00", "000000", "x12", "#12", "12 34", "١٢", "0", "9",
        "99", "999", "9999", "99999", "999999", "ext12", "12ext", "+12", "1e3", "12/3"],
    },
    {
      name: "website",
      parse: (v) => optHttpsUrl().parse(v),
      db: HTTPS_DB_RE,
      values: [
        "https://bank.example", "https://bank.example/", "https://bank.example/lending", "https://Bank.Example/a?b=1#c", "https://a.b.c.example/x/y/z", "https://x.com/<script>", "https://x.com/a b", "https://x.com/\"q\"", "https://x.com:443/", "https://x.com:8443/",
        "http://x.com", "javascript:alert(1)", "data:text/html,x", "https://user:pw@x.com", "https://user@x.com", "https://localhost/", "https://127.0.0.1/", "https://[::1]/", "https://bücher.example/", "https://x.com/%20",
        "https://x.com/a;b", "https://x.com/a|b", "https://x.com/~u", "https://x.com/a{b}", "https://x.com/a\\b", "https://x.com/é", "ftp://x.com", "https:x.com", "https:///x.com", "https://x.com/a`b",
      ],
    },
    {
      name: "portal",
      parse: (v) => optHttpsUrl({ portal: true }).parse(v),
      db: PORTAL_DB_RE,
      values: [
        "https://portal.example/login", "https://portal.example/login?token=abc", "https://portal.example/login#frag", "https://portal.example/a?b#c", "https://portal.example/?", "https://portal.example/#", "https://portal.example", "https://Portal.Example/Login", "https://x.com/a b", "https://x.com/<x>",
        "http://portal.example", "https://u:p@portal.example", "https://portal.example:8443", "javascript:alert(1)", "https://localhost", "https://x.com/%3F", "https://x.com/%23", "https://x.com/a/b/c", "https://x.com/a.b", "https://x.com/a_b",
        "https://x.com/a-b", "https://x.com/a+b", "https://x.com/a=b", "https://x.com/a&b", "https://x.com/a@b", "https://x.com/a!b", "https://x.com/a$b", "https://x.com/a'b", "https://x.com/a(b)", "https://x.com/a*b",
      ],
    },
    {
      name: "state",
      parse: (v) => optState.parse(v),
      db: STATE_RE,
      values: ["CA", "ca", "Ca", "NV", "ny", "C", "CAL", "C1", "1A", "C-", " ca ", "TX", "tx", "ÇA", "XX", "zz", "AA", "C A", "c​a", "WA",
        "or", "OR", "hi", "AK", "DC", "PR", "GU", "VI", "AS", "MP"],
    },
    {
      name: "postal",
      parse: (v) => optPostal.parse(v),
      db: POSTAL_RE,
      values: ["90012", "90210-1234", "9021", "sw1a 1aa", "M5V 2T6", "10115", "75008", "2000", "1", "12", "-123", " 90012 ", "900 12", "90012-", "ABCDEFGHIJ", "ABCDEFGHIJK", "A_B", "A.B", "A/B", "ÄB1",
        "00000", "99999-9999", "K1A0B1", "EC1A1BB", "D02 X285", "1010", "0200", "AB", "A1", "ZZZZ"],
    },
    {
      name: "nmls",
      parse: (v) => nmlsId.parse(v),
      db: NMLS_RE,
      values: ["1", "12", "1234", "123456", "1234567890", "12345678901", "a", "12a", "-1", "1.0", " 12 ", "0", "00", "NMLS 1", "#1234", "12 34", "١٢٣", "999999", "3029", "1e5",
        "+1", "1_000", "1,000", "0x1", "12345", "7", "77", "777", "7777", "77777"],
    },
  ];

  for (const s of samples) {
    it(`${s.name}: everything zod accepts passes the database check`, () => {
      expect(s.values).toHaveLength(30);
      let accepted = 0;
      for (const v of s.values) {
        let out: unknown;
        try {
          out = s.parse(v);
        } catch {
          continue;
        }
        if (out === null) continue;
        accepted += 1;
        expect(s.db.test(String(out)), `${s.name} ${JSON.stringify(v)} -> ${JSON.stringify(out)}`).toBe(true);
      }
      expect(accepted).toBeGreaterThan(3);
    });
  }

  it("US ZIP codes match the lender_panel_us_postal_code check", () => {
    for (const v of ["90012", "90210-1234"]) expect(US_ZIP_RE.test(lenderContactInfoSchema.parse({ postalCode: v }).postalCode!)).toBe(true);
  });
});

describe("deriveLenderContacts", () => {
  const lender = { submissionEmail: "Submissions@Lender.example", generalEmail: "info@lender-group.example" };
  const c = (over: Partial<{ id: string; fullName: string; email: string | null; isPrimary: boolean; status: "active" | "left" }>) => ({ id: "c1", fullName: "Dana Lee", email: "dana@lender.example", isPrimary: false, status: "active" as const, ...over });

  it("uses the primary contact (name and email) when it has an email", () => {
    expect(deriveLenderContacts(lender, [c({ isPrimary: true })])).toMatchObject({ primaryContactId: "c1", primaryContactName: "Dana Lee", contactName: "Dana Lee", contactEmail: "dana@lender.example" });
  });

  it("falls back to the submission inbox (no name) for a primary without an email, or no primary", () => {
    expect(deriveLenderContacts(lender, [c({ isPrimary: true, email: null })])).toMatchObject({ primaryContactName: "Dana Lee", contactName: null, contactEmail: "Submissions@Lender.example" });
    expect(deriveLenderContacts(lender, [c({})])).toMatchObject({ primaryContactId: null, contactName: null, contactEmail: "Submissions@Lender.example" });
  });

  it("is null with nothing on file, and ignores a contact who left", () => {
    expect(deriveLenderContacts({ submissionEmail: null, generalEmail: null }, [])).toEqual({ primaryContactId: null, primaryContactName: null, contactName: null, contactEmail: null, contactDomains: [] });
    expect(deriveLenderContacts({ submissionEmail: null, generalEmail: null }, [c({ isPrimary: true, status: "left", email: "gone@old.example" })])).toMatchObject({ primaryContactId: null, contactEmail: null, contactDomains: [] });
  });

  it("lists lower-case, deduped, sorted domains including the general inbox", () => {
    const d = deriveLenderContacts(lender, [c({ email: "A@Zeta.example" }), c({ id: "c2", email: "b@zeta.example" }), c({ id: "c3", email: "x@left.example", status: "left" })]);
    expect(d.contactDomains).toEqual(["lender-group.example", "lender.example", "zeta.example"]);
  });
});

describe("phone display", () => {
  it("formats NANP numbers and builds tel: links with extensions", () => {
    expect(formatPhone("+13105550100")).toBe("(310) 555-0100");
    expect(formatPhone("+442079460000")).toBe("+442079460000");
    expect(telHref("+13105550100")).toBe("tel:+13105550100");
    expect(telHref("+13105550100", "12")).toBe("tel:+13105550100;ext=12");
    expect(telHref("+13105550100", null)).toBe("tel:+13105550100");
  });
});
