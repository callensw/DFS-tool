import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NBA DFS Optimizer",
  description: "NBA DraftKings DFS lineup optimization tool",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
