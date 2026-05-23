// src/app/(app)/layout.tsx
import { ProfileProvider } from "../components/ProfileProvider";
import ProfileSetupModal from "../components/ProfileSetupModal";
import AppShell from "../components/shell/AppShell";
import { UploadQueueProvider } from "../components/upload/UploadQueueProvider";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-50">
      <ProfileProvider>
        <UploadQueueProvider>
          <ProfileSetupModal />
          <AppShell>{children}</AppShell>
        </UploadQueueProvider>
      </ProfileProvider>
    </div>
  );
}
