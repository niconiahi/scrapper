import type { Metadata } from 'next'
import './globals.css'

// Self-hosted Google Fonts via Fontsource. Family names match captured CSS
// verbatim (e.g. font-family: Arima), so no rewriting needed.
import '@fontsource/arima/300.css'
import '@fontsource/arima/400.css'
import '@fontsource/arima/500.css'
import '@fontsource/arima/600.css'
import '@fontsource/arima/700.css'
import '@fontsource/dm-sans/400.css'
import '@fontsource/dm-sans/500.css'

export const metadata: Metadata = {
  title: 'Scrapper',
  description: 'Scrapped DOM → React',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
