"use client";

import { hardNavigate } from "@/lib/hard-navigate";
import { useState, type FormEvent } from "react";
import { Button, Field, inputClass } from "@/components/ui";
import { authErrorMessage, PASSWORD_HINT, passwordProblem } from "@/lib/auth-errors";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Notice } from "./auth-card";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const { error: resetError } = await getBrowserSupabase().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });
    setPending(false);
    if (resetError) setError(authErrorMessage(resetError));
    else setSent(true);
  }

  if (sent) {
    return <Notice tone="success">Se existir uma conta para este e-mail, você receberá um link em instantes. Abra-o neste navegador.</Notice>;
  }
  return (
    <form onSubmit={submit} className="grid gap-4">
      <Field label="E-mail">
        <input type="email" required autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} className={inputClass} />
      </Field>
      {error && <Notice tone="error">{error}</Notice>}
      <Button type="submit" disabled={pending}>{pending ? "Enviando…" : "Enviar link"}</Button>
    </form>
  );
}

/** Reached through the recovery link: the callback already created a short session. */
export function ResetPasswordForm() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const problem = passwordProblem(password) ?? (password !== confirm ? "As senhas não coincidem." : null);
    if (problem) {
      setError(problem);
      return;
    }
    setPending(true);
    setError(null);
    const supabase = getBrowserSupabase();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setPending(false);
      setError(authErrorMessage(updateError));
      return;
    }
    // Sign out everywhere so the new password is required on every device.
    await supabase.auth.signOut({ scope: "global" });
    hardNavigate("/login?reset=1");
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <Field label="Nova senha" hint={PASSWORD_HINT}>
        <input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} className={inputClass} />
      </Field>
      <Field label="Confirmar nova senha">
        <input type="password" required minLength={8} autoComplete="new-password" value={confirm} onChange={event => setConfirm(event.target.value)} className={inputClass} />
      </Field>
      {error && <Notice tone="error">{error}</Notice>}
      <Button type="submit" disabled={pending}>{pending ? "Salvando…" : "Salvar nova senha"}</Button>
    </form>
  );
}
