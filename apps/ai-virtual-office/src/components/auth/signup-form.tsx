"use client";

import { hardNavigate } from "@/lib/hard-navigate";
import { useState, type FormEvent } from "react";
import { Button, Field, inputClass } from "@/components/ui";
import { authErrorMessage, PASSWORD_HINT, passwordProblem } from "@/lib/auth-errors";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Notice } from "./auth-card";

export function SignupForm() {
  const [form, setForm] = useState({ fullName: "", email: "", password: "", confirm: "" });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) => setForm(current => ({ ...current, [key]: event.target.value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    const fullName = form.fullName.trim();
    const problem = !fullName ? "Informe seu nome." : passwordProblem(form.password) ?? (form.password !== form.confirm ? "As senhas não coincidem." : null);
    if (problem) {
      setError(problem);
      return;
    }
    setPending(true);
    setError(null);
    const { data, error: signUpError } = await getBrowserSupabase().auth.signUp({
      email: form.email.trim(),
      password: form.password,
      options: {
        data: { full_name: fullName.slice(0, 80) },
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/`,
      },
    });
    setPending(false);
    if (signUpError) {
      setError(authErrorMessage(signUpError));
      return;
    }
    if (data.session) {
      hardNavigate("/");
      return;
    }
    setSentTo(form.email.trim());
  }

  if (sentTo) {
    return (
      <Notice tone="success">
        Quase lá! Enviamos um link de confirmação para <strong>{sentTo}</strong>. Abra-o neste navegador para ativar sua conta.
      </Notice>
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <Field label="Nome">
        <input required maxLength={80} autoComplete="name" value={form.fullName} onChange={set("fullName")} className={inputClass} />
      </Field>
      <Field label="E-mail">
        <input type="email" required autoComplete="email" value={form.email} onChange={set("email")} className={inputClass} />
      </Field>
      <Field label="Senha" hint={PASSWORD_HINT}>
        <input type="password" required minLength={8} autoComplete="new-password" value={form.password} onChange={set("password")} className={inputClass} />
      </Field>
      <Field label="Confirmar senha">
        <input type="password" required minLength={8} autoComplete="new-password" value={form.confirm} onChange={set("confirm")} className={inputClass} />
      </Field>
      {error && <Notice tone="error">{error}</Notice>}
      <Button type="submit" disabled={pending}>{pending ? "Criando conta…" : "Criar conta"}</Button>
    </form>
  );
}
