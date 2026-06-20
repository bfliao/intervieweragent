import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Question Arena",
  description:
    "A testing portal for ambiguity-based candidate assessment scenarios.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
