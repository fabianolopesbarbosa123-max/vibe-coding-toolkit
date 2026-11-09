import { AuthCard } from "@/components/auth/auth-card";
import { ResetPasswordForm } from "@/components/auth/password-forms";

export default function ResetPasswordPage() {
  return (
    <AuthCard title="Nova senha" subtitle="Escolha uma nova senha para sua conta.">
      <ResetPasswordForm />
    </AuthCard>
  );
}
