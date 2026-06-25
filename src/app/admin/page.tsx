"use client";

import TableCupomFiscal from "@/components/admin/TableCupomFiscal";
import TableCupomFiscalAI from "@/components/admin/TableCupomFiscalAI";
import { useState } from "react";

const tabs = [
  { id: "nfce", label: "Cupom Fiscal" },
  { id: "nfce-ai", label: "Cupom Fiscal IA" },
];

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState("nfce-ai");

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <nav className="flex gap-1 border-b border-gray-200">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-3 text-sm font-semibold border-b-2 transition-colors ${
              activeTab === tab.id
                ? "border-purple-600 text-purple-700"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {/* Content */}
      {activeTab === "nfce" && <TableCupomFiscal />}
      {activeTab === "nfce-ai" && <TableCupomFiscalAI />}
    </div>
  );
}
