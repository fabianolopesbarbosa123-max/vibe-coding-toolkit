"use client";

import { hardNavigate } from "@/lib/hard-navigate";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Field, inputClass } from "@/components/ui";
import { authErrorMessage } from "@/lib/auth-errors";
import { safeNext } from "@/lib/safe-next";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Notice } from "./auth-card";

const LINK_ERRORS: Record<string, string> = {
  link: "O link expirou ou já foi usado. Solicite um novo.",
  callback: "Não foi possível validar o link. Abra-o no mesmo navegador em que fez a solicitação.",
};


export function LoginForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(LINK_ERRORS[params.get("error") ?? ""] ?? null);
  const reset = params.get("reset") === "1";

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const { error: signInError } = await getBrowserSupabase().auth.signInWithPassword({ email, password });
    if (signInError) {
      setError(authErrorMessage(signInError));
      setPending(false);
      return;
    }
    // Full navigation so the proxy sees the new session cookie.
    hardNavigate(safeNext(params.get("next")));
  }

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate={false}>
      {reset && <Notice tone="success">Senha alterada. Entre com a nova senha.</Notice>}
      <Field label="E-mail">
        <input type="email" required autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} className={inputClass} />
      </Field>
      <Field label="Senha">
        <input type="password" required autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} className={inputClass} />
      </Field>
      <div className="-mt-2 text-right text-xs">
        <Link href="/forgot-password" className="text-indigo-300 hover:underline">Esqueci minha senha</Link>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <Button type="submit" disabled={pending}>{pending ? "Entrando…" : "Entrar"}</Button>
    </form>
  );
}
