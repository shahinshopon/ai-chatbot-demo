import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TulipTech AI",
  description: "Upload your business documents and instantly create a secure AI assistant trained only on your files.",
  icons: {
    icon: "/logo.jpg",
    apple: "/logo.jpg",
  },
  openGraph: {
    title: "TulipTech AI",
    description: "Upload your business documents and instantly create a secure AI assistant trained only on your files.",
    siteName: "TulipTech AI",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className="h-full antialiased font-sans"
    >
      <body className="min-h-full flex flex-col overflow-x-hidden">{children}</body>
    </html>
  );
}
