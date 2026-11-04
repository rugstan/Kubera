import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";

export const alt = "Corin Commercial: commercial real estate loan brokerage";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// The owner's logo artwork (assets/brand/corin-logo.png, 1601 x 407). Read at
// build time, when this image is generated, and inlined as a data URL.
const LOGO = { width: 1601, height: 407 };
const LOGO_HEIGHT = 84;

export default async function OpenGraphImage() {
  const logo = await readFile(path.join(process.cwd(), "assets/brand/corin-logo.png"));
  const logoSrc = `data:image/png;base64,${logo.toString("base64")}`;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: "#ffffff",
          color: "#1d1d1f",
        }}
      >
        <div style={{ display: "flex", alignItems: "center" }}>
          <img src={logoSrc} alt="Corin Commercial" width={Math.round((LOGO_HEIGHT * LOGO.width) / LOGO.height)} height={LOGO_HEIGHT} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 68, fontWeight: 700, lineHeight: 1.08, letterSpacing: -2 }}>We help you find the right lender for your commercial real estate loan.</div>
          <div style={{ fontSize: 30, color: "#6e6e73" }}>HUD, SBA, CMBS, agency, construction and hard money loans. Advisor-led.</div>
        </div>
        <div style={{ fontSize: 22, color: "#6e6e73" }}>Licensed California real estate broker. Not a lender.</div>
      </div>
    ),
    size,
  );
}
