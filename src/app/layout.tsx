import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VITRION_01 · Anatomical Research",
  description: "An anatomical reference workspace with 206 adult bone records and licensed 3D model integration. Research use only; not a diagnostic tool.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
