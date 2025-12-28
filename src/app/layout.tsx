import Navbar from "./components/Navbar";
import { ProfileProvider } from "./components/ProfileProvider";
import "./globals.css";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-50">
        <ProfileProvider>
          <Navbar />
          {children}
        </ProfileProvider>
      </body>
    </html>
  );
}
