"use client";

import { WithSnapshot } from "@/components/page-state";
import { ProfileForm } from "@/components/profile/profile-form";

export default function ProfilePage() {
  return (
    <WithSnapshot>
      {snapshot => (
        <div className="grid gap-4">
          <h1 className="text-xl font-semibold text-slate-100">Meu perfil</h1>
          <ProfileForm key={snapshot.profile.id} snapshot={snapshot} />
        </div>
      )}
    </WithSnapshot>
  );
}
