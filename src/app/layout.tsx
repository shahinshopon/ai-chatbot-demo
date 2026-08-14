import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-plus-jakarta",
  weight: ["300", "400", "500", "600", "700", "800"],
  display: "swap",
});

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
      className={`h-full antialiased ${plusJakarta.variable}`}
    >
      <body className={`min-h-full flex flex-col overflow-x-hidden ${plusJakarta.className}`}>{children}</body>
    </html>
  );
}
