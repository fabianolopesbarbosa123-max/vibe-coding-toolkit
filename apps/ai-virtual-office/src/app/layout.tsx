import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppNav } from "@/components/app-nav";
import { OfficeProvider } from "@/components/office-provider";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "AI Virtual Office",
  description: "Escritório virtual para administrar agentes de IA, tarefas e projetos.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <OfficeProvider>
          <AppNav />
          <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">{children}</main>
        </OfficeProvider>
      </body>
    </html>
  );
}
