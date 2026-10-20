import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import Providers from "@/components/Providers";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import WinnerBanner from "@/components/WinnerBanner";

// Self-hosted latin variable fonts (from Google Fonts). next/font/google made Turbopack fetch and
// parse Google's CSS at dev time, and a bad cached response broke every page.
const fredoka = localFont({
  src: "./fonts/fredoka-latin.woff2",
  variable: "--font-fredoka",
  weight: "500 700",
  display: "swap",
});
const nunito = localFont({
  src: "./fonts/nunito-latin.woff2",
  variable: "--font-nunito",
  weight: "200 1000",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "floorvault: coins that buy NFTs", template: "%s | floorvault" },
  description:
    "Launch a coin on Monad. Its creator fees buy NFTs from a collection you pick. Watch the vault sweep the floor.",
};

export const viewport: Viewport = {
  themeColor: "#0b0a10",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${fredoka.variable} ${nunito.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <Providers>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-brand focus:px-4 focus:py-2 focus:font-bold focus:text-ink"
          >
            Skip to content
          </a>
          <Header />
          <WinnerBanner />
          <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 pb-20 pt-6 sm:px-6 sm:pt-10">
            {children}
          </main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
