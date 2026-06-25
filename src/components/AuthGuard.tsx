"use client";

import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const adminRole = process.env.NEXT_PUBLIC_ROLE_ADM || "";

  useEffect(() => {
    if (!isLoading && !user?.accessToken) {
      router.replace("/login");
    }
  }, [user, isLoading, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin h-8 w-8 border-4 border-purple-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!user?.accessToken) return null;

  // Check admin role if configured
  if (adminRole && user.role !== adminRole) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white rounded-xl shadow-lg p-8 text-center">
          <h2 className="text-xl font-bold text-red-600 mb-2">Acesso negado</h2>
          <p className="text-gray-600">Você não tem permissão para acessar o painel admin.</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
