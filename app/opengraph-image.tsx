import { ImageResponse } from "next/og";

export const alt = "Kubera Commercial: commercial real estate loan brokerage";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
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
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ width: 64, height: 64, borderRadius: 18, background: "#1d1d1f", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none">
              <path d="M8 6v12M8 12l7-6M10.5 10l5 8" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div style={{ fontSize: 36, fontWeight: 600 }}>Kubera Commercial</div>
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
