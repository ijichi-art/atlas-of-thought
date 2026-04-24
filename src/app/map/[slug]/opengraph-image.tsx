import { ImageResponse } from "next/og";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const contentType = "image/png";
export const size = { width: 1200, height: 630 };

export default async function OgImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const map = await prisma.map.findFirst({
    where: { shareSlug: slug, visibility: { not: "private" } },
    select: {
      title: true,
      _count: { select: { cities: true, countries: true } },
    },
  });

  const title = map?.title ?? "Atlas of Thought";
  const cities = map?._count.cities ?? 0;
  const countries = map?._count.countries ?? 0;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "linear-gradient(135deg, #1c1917 0%, #292524 60%, #1c1917 100%)",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          fontFamily: "serif",
          position: "relative",
        }}
      >
        {/* Subtle grid decoration */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              "radial-gradient(circle at 20% 50%, rgba(196,212,190,0.08) 0%, transparent 50%), radial-gradient(circle at 80% 20%, rgba(200,184,216,0.08) 0%, transparent 50%)",
          }}
        />

        <div style={{ display: "flex", alignItems: "center", marginBottom: 24, gap: 12 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#c4d4be" }} />
          <span style={{ color: "#a8a29e", fontSize: 18, letterSpacing: "0.15em", textTransform: "uppercase" }}>
            Atlas of Thought
          </span>
        </div>

        <div
          style={{
            color: "#f5f5f4",
            fontSize: cities > 0 ? 72 : 80,
            fontWeight: 700,
            lineHeight: 1.1,
            maxWidth: 900,
            marginBottom: 32,
          }}
        >
          {title}
        </div>

        {cities > 0 && (
          <div style={{ display: "flex", gap: 32, color: "#a8a29e", fontSize: 24 }}>
            <span>{cities} {cities === 1 ? "city" : "cities"}</span>
            <span>·</span>
            <span>{countries} {countries === 1 ? "country" : "countries"}</span>
          </div>
        )}
      </div>
    ),
    { ...size }
  );
}
