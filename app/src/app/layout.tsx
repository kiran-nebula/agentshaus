import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
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
          <div className="pl-[240px] min-h-dvh">
            <div className="fixed top-0 right-0 z-30 flex h-14 items-center pr-8" style={{ left: '240px' }}>
              <div className="ml-auto">
                <WalletButton />
              </div>
            </div>
            <div className="pt-14">
              {children}
            </div>
          </div>
        </Providers>
      </body>
    </html>
  );
}
