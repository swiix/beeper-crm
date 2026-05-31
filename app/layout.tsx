import type { Metadata } from "next";
import Script from "next/script";
import { Nunito } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";

const nunito = Nunito({
  subsets: ["latin"],
  variable: "--font-tinder",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Beeper CRM – Instagram Akquise & Sales",
  description: "Chats verwalten, analysieren und ins CRM überführen.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de" suppressHydrationWarning>
      <body className={`min-h-screen font-sans ${nunito.variable}`}>
        <Script
          id="theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var k="beeper-crm:colorTheme";var t=localStorage.getItem(k);document.documentElement.setAttribute("data-theme",t==="dark"?"dark":"light");}catch(e){document.documentElement.setAttribute("data-theme","light");}})();`,
          }}
        />
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
