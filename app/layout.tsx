import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Alchemyst Agent Console",
  description: "Real-time agent console for the Alchemyst Full Stack AI assignment",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
