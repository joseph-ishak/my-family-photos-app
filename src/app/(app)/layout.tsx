// src/app/(app)/layout.tsx
import { ProfileProvider } from "../components/ProfileProvider";
import ProfileSetupModal from "../components/ProfileSetupModal";
import AppShell from "../components/shell/AppShell";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-50">
      <ProfileProvider>
        <ProfileSetupModal />
        <AppShell>{children}</AppShell>
      </ProfileProvider>
    </div>
  );
}
