"use client";

import { useState, type FormEvent } from "react";
import { useOffice } from "@/components/office-provider";
import { Button, Card, ErrorText, Field, inputClass } from "@/components/ui";
import type { OfficeSnapshot } from "@/lib/api-types";
import { PROVIDERS, type Provider } from "@/lib/domain";
import { PROVIDER_LABELS } from "@/lib/labels";
import { getBrowserSupabase } from "@/lib/supabase/browser";

export function ProfileForm({ snapshot }: { snapshot: OfficeSnapshot }) {
  const { post, notify } = useOffice();
  const [fullName, setFullName] = useState(snapshot.profile.fullName);
  const [settings, setSettings] = useState(snapshot.settings);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editable = snapshot.mode === "supabase";

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await post("/api/profile", { fullName, settings }, "PATCH");
      notify("Perfil atualizado.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Dados da conta">
        <form onSubmit={submit} className="grid gap-4">
          <Field label="Nome">
            <input required maxLength={80} value={fullName} onChange={event => setFullName(event.target.value)} disabled={!editable} className={inputClass} />
          </Field>
          <Field label="E-mail">
            <input value={snapshot.profile.email ?? "—"} disabled className={inputClass} />
          </Field>
          <fieldset className="grid gap-3 rounded-xl border border-white/10 p-3">
            <legend className="px-1 text-sm font-medium text-slate-300">Preferências</legend>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" className="accent-indigo-500" disabled={!editable} checked={settings.autoRun} onChange={event => setSettings(current => ({ ...current, autoRun: event.target.checked }))} />
              Executar projetos automaticamente após o planejamento do CEO
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" className="accent-indigo-500" disabled={!editable} checked={settings.reducedMotion} onChange={event => setSettings(current => ({ ...current, reducedMotion: event.target.checked }))} />
              Reduzir animações do escritório
            </label>
            <Field label="Integração padrão para novos agentes">
              <select value={settings.defaultProvider} disabled={!editable} onChange={event => setSettings(current => ({ ...current, defaultProvider: event.target.value as Provider }))} className={inputClass}>
                {PROVIDERS.map(provider => <option key={provider} value={provider}>{PROVIDER_LABELS[provider]}</option>)}
              </select>
            </Field>
          </fieldset>
          <fieldset className="grid gap-3 rounded-xl border border-white/10 p-3">
            <legend className="px-1 text-sm font-medium text-slate-300">Orçamento de IA</legend>
            <Field label="Alertar ao atingir (% do limite mensal)">
              <input type="number" min={1} max={100} required disabled={!editable} value={settings.budgetAlertPercent} onChange={event => setSettings(current => ({ ...current, budgetAlertPercent: Number(event.target.value) }))} className={inputClass} />
            </Field>
            <Field label="Meu limite mensal (US$, opcional)" hint={`Só pode reduzir o limite definido pelo administrador${snapshot.budget.limits.monthlyBudgetUsd !== null && snapshot.budget.limits.source !== "personal" ? ` (atual: US$ ${snapshot.budget.limits.monthlyBudgetUsd.toFixed(2)})` : ""}. Deixe vazio para usar o limite do administrador.`}>
              <input
                type="number"
                min={0}
                step="0.01"
                disabled={!editable}
                value={settings.personalMonthlyBudgetUsd ?? ""}
                onChange={event => setSettings(current => ({ ...current, personalMonthlyBudgetUsd: event.target.value === "" ? null : Number(event.target.value) }))}
                className={inputClass}
              />
            </Field>
          </fieldset>
          <ErrorText>{error}</ErrorText>
          {editable ? (
            <Button type="submit" disabled={pending}>{pending ? "Salvando…" : "Salvar alterações"}</Button>
          ) : (
            <p className="text-sm text-amber-300">Perfil disponível apenas com o Supabase configurado.</p>
          )}
        </form>
      </Card>
      <Card title="Segurança">
        <p className="text-sm text-slate-400">Para trocar a senha, enviaremos um link de recuperação para o seu e-mail.</p>
        {editable && snapshot.profile.email && <SendResetLink email={snapshot.profile.email} />}
        <p className="mt-4 text-xs text-slate-500">Seus dados (agentes, projetos, tarefas, conversas, arquivos e histórico) são visíveis apenas para você.</p>
      </Card>
    </div>
  );
}

function SendResetLink({ email }: { email: string }) {
  const { notify } = useOffice();
  const [pending, setPending] = useState(false);
  async function send() {
    setPending(true);
    const { error } = await getBrowserSupabase().auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });
    setPending(false);
    notify(error ? "Não foi possível enviar o link agora. Tente novamente." : `Link enviado para ${email}.`, error ? "error" : "success");
  }
  return (
    <Button type="button" variant="ghost" className="mt-3" onClick={send} disabled={pending}>
      {pending ? "Enviando…" : "Enviar link para trocar a senha"}
    </Button>
  );
}
