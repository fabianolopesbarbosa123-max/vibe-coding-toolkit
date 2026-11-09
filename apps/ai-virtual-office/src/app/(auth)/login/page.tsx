import { Suspense } from "react";
import Link from "next/link";
import { AuthCard } from "@/components/auth/auth-card";
import { LoginForm } from "@/components/auth/login-form";

export default function LoginPage() {
  return (
    <AuthCard
      title="Entrar"
      subtitle="Acesse seu escritório virtual."
      footer={<>Ainda não tem conta? <Link href="/signup" className="text-indigo-300 hover:underline">Criar conta</Link></>}
    >
      <Suspense fallback={<p className="text-sm text-slate-400">Carregando…</p>}>
        <LoginForm />
      </Suspense>
    </AuthCard>
  );
}
