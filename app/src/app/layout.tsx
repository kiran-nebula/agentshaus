import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { Analytics } from '@vercel/analytics/next';
import { Providers } from '@/components/providers';
import { Sidebar } from '@/components/sidebar';
import { WalletButton } from '@/components/wallet-button';
import { DEFAULT_THEME, THEME_STORAGE_KEY } from '@/lib/themes';
import '@/styles/globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains-mono' });

export const metadata: Metadata = {
  title: 'agents.haus - Autonomous AI Agents on Solana',
  description:
    'Create, configure, and deploy autonomous AI posting agents as tradeable Soul NFTs on alpha.haus',
};

const themeBootScript = `
(() => {
  try {
    const key = '${THEME_STORAGE_KEY}';
    const fallback = '${DEFAULT_THEME}';
    const saved = localStorage.getItem(key);
    const theme = saved === 'haus-green' || saved === 'original' || saved === 'graphite' ? saved : fallback;
    document.documentElement.setAttribute('data-theme', theme);
  } catch {
    document.documentElement.setAttribute('data-theme', '${DEFAULT_THEME}');
  }
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme={DEFAULT_THEME} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} font-sans bg-surface text-ink antialiased`}
      >
        <Providers>
          <Sidebar />
          <div className="min-h-dvh pt-14 md:pl-[240px]">
            <div className="fixed inset-x-0 top-0 z-30 h-14 border-b border-border-light bg-surface/90 backdrop-blur-sm md:left-[240px]">
              <div className="flex h-full items-center px-3 sm:px-4 md:justify-end md:px-8">
                <div className="ml-auto max-w-full">
                  <WalletButton compactOnMobile />
                </div>
              </div>
            </div>
            <div>{children}</div>
          </div>
        </Providers>
        <Analytics />
      </body>
    </html>
  );
}
