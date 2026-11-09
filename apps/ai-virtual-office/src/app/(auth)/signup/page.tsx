import Link from "next/link";
import { AuthCard } from "@/components/auth/auth-card";
import { SignupForm } from "@/components/auth/signup-form";

export default function SignupPage() {
  return (
    <AuthCard
      title="Criar conta"
      subtitle="Seu escritório com seis agentes de IA prontos para trabalhar."
      footer={<>Já tem conta? <Link href="/login" className="text-indigo-300 hover:underline">Entrar</Link></>}
    >
      <SignupForm />
    </AuthCard>
  );
}
