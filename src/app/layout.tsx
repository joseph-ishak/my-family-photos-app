// src/app/layout.tsx
import { ProfileProvider } from "./components/ProfileProvider";
import "./globals.css";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <ProfileProvider>{children}</ProfileProvider>
      </body>
    </html>
  );
}
