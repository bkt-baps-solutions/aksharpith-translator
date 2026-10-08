// Headless backend service — no UI ships here. The frontend lives in
// translation-tool/. We only render this minimal layout so Next.js' build
// step is happy.

export const metadata = {
  title: 'transliterator-baps API',
  description: 'Backend service for handwritten Gujarati transliteration.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
