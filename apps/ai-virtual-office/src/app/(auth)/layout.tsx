import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2 text-lg font-semibold text-slate-100">
          <span className="grid size-9 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-xs font-black">AI</span>
          AI Virtual Office
        </div>
        {children}
      </div>
    </main>
  );
}
