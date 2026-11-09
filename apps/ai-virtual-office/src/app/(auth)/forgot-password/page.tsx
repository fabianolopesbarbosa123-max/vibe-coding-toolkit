import Link from "next/link";
import { AuthCard } from "@/components/auth/auth-card";
import { ForgotPasswordForm } from "@/components/auth/password-forms";

export default function ForgotPasswordPage() {
  return (
    <AuthCard
      title="Recuperar senha"
      subtitle="Enviaremos um link para você criar uma nova senha."
      footer={<Link href="/login" className="text-indigo-300 hover:underline">Voltar para o login</Link>}
    >
      <ForgotPasswordForm />
    </AuthCard>
  );
}
