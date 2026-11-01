import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// Generated at build time so no binary asset has to be committed.
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#1d1d1f" }}>
        <svg width="120" height="120" viewBox="0 0 24 24" fill="none">
          <path d="M8 6v12M8 12l7-6M10.5 10l5 8" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    ),
    size,
  );
}
