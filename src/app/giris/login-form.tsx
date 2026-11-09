"use client";

import { useActionState } from "react";
import { login } from "@/app/actions";
import { btnPrimary, input, label } from "@/lib/ui";

export function LoginForm() {
  const [error, action, pending] = useActionState(login, null);
  return (
    <form action={action} className="mt-6 grid gap-4">
      <label>
        <span className={label}>Şifre</span>
        <input name="password" type="password" required autoFocus autoComplete="current-password" className={input} />
      </label>
      {error && (
        <p role="alert" className="rounded-xl bg-brand/15 px-3.5 py-2.5 text-sm text-white ring-1 ring-brand/40">
          {error}
        </p>
      )}
      <button type="submit" disabled={pending} className={btnPrimary}>
        Giriş yap
      </button>
    </form>
  );
}
