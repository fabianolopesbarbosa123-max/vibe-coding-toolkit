/** Maps Supabase Auth error codes to clear pt-BR messages without exposing internals. */
const MESSAGES: Record<string, string> = {
  invalid_credentials: "E-mail ou senha incorretos.",
  email_not_confirmed: "Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada.",
  user_already_exists: "Já existe uma conta com este e-mail.",
  email_exists: "Já existe uma conta com este e-mail.",
  weak_password: "Senha fraca: use ao menos 8 caracteres com letras maiúsculas, minúsculas e números.",
  same_password: "A nova senha deve ser diferente da atual.",
  over_email_send_rate_limit: "Muitos e-mails enviados. Aguarde alguns minutos e tente novamente.",
  over_request_rate_limit: "Muitas tentativas. Aguarde um pouco e tente novamente.",
  signup_disabled: "Novos cadastros estão desativados.",
  session_not_found: "Sua sessão expirou. Entre novamente.",
  email_address_invalid: "E-mail inválido.",
  validation_failed: "Dados inválidos. Revise os campos.",
};

export function authErrorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const { code, name, message } = error as { code?: string; name?: string; message?: string };
    if (code && MESSAGES[code]) return MESSAGES[code];
    if (name === "AuthRetryableFetchError" || message === "Failed to fetch") {
      return "Sem conexão com o servidor de autenticação. Verifique sua internet.";
    }
  }
  return "Não foi possível concluir. Tente novamente.";
}

export const PASSWORD_HINT = "Mínimo de 8 caracteres, com letras maiúsculas, minúsculas e números.";

export function passwordProblem(password: string): string | null {
  if (password.length < 8) return "A senha precisa ter ao menos 8 caracteres.";
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
    return "Use letras maiúsculas, minúsculas e números.";
  }
  return null;
}
