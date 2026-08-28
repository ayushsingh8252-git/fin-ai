"use client";

import { useEffect, useState } from "react";
import { Search, ShieldCheck, RefreshCw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";

type RuleItem = {
  id: string;
  document_id?: string;
  canonical_rule: string;
  type: string;
  confidence: number;
  page?: number;
  section?: string;
};

export default function RulesExplorerPage() {
  const [search, setSearch] = useState("");
  const [rules, setRules] = useState<RuleItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchRules = async () => {
    setIsLoading(true);
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      const res = await fetch(`${apiUrl}/api/v1/rules`);
      if (res.ok) {
        const data = await res.json();
        if (data.rules && Array.isArray(data.rules)) {
          setRules(data.rules);
        }
      }
    } catch (err) {
      console.error("Failed to fetch live rules:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchRules();
  }, []);

  const filteredRules = rules.filter(r => 
    (r.canonical_rule || "").toLowerCase().includes(search.toLowerCase()) ||
    (r.type || "").toLowerCase().includes(search.toLowerCase()) ||
    (r.section || "").toLowerCase().includes(search.toLowerCase()) ||
    (r.document_id || "").toLowerCase().includes(search.toLowerCase())
  );

  const getTypeColor = (type: string) => {
    switch((type || "").toUpperCase()) {
      case "OBLIGATION": return "bg-blue-500/10 text-blue-600 border-blue-500/20";
      case "PROHIBITION": return "bg-red-500/10 text-red-600 border-red-500/20";
      case "PERMISSION": return "bg-emerald-500/10 text-emerald-600 border-emerald-500/20";
      default: return "bg-amber-500/10 text-amber-600 border-amber-500/20";
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-white bg-white-grid relative p-8 overflow-auto">
      <div className="max-w-6xl w-full mx-auto space-y-6">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-zinc-900 mb-2">Rule Explorer</h1>
            <p className="text-zinc-500">Search and filter through all live extracted and validated policy rules.</p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={fetchRules}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
              Refresh Rules
            </Button>
          </div>
        </div>

        <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden shadow-sm">
          <div className="p-4 border-b border-zinc-200 bg-zinc-50/70 flex gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search extracted rules, document IDs, or sections..."
                className="pl-9"
              />
            </div>
          </div>

          <Table>
            <TableHeader className="bg-zinc-50">
              <TableRow className="border-zinc-200 hover:bg-transparent">
                <TableHead className="text-zinc-500 font-medium">Rule ID</TableHead>
                <TableHead className="text-zinc-500 font-medium">Canonical Rule</TableHead>
                <TableHead className="text-zinc-500 font-medium">Type</TableHead>
                <TableHead className="text-zinc-500 font-medium">Confidence</TableHead>
                <TableHead className="text-zinc-500 font-medium">Page</TableHead>
                <TableHead className="text-zinc-500 font-medium">Section</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-zinc-500">
                    Loading live extracted rules from backend...
                  </TableCell>
                </TableRow>
              ) : filteredRules.length > 0 ? (
                filteredRules.map((rule) => (
                  <TableRow key={rule.id} className="border-zinc-100 hover:bg-zinc-50 transition-colors">
                    <TableCell className="font-mono text-xs text-zinc-400">{rule.id.substring(0, 8)}...</TableCell>
                    <TableCell className="font-medium text-zinc-800">{rule.canonical_rule}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={getTypeColor(rule.type)}>
                        {rule.type || "GUIDELINE"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm font-medium text-zinc-700">{rule.confidence}%</span>
                    </TableCell>
                    <TableCell className="text-zinc-500 text-sm">
                      Page {rule.page || 1}
                    </TableCell>
                    <TableCell className="text-zinc-500 text-sm">{rule.section || "General"}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={6}>
                    <EmptyState
                      icon={ShieldCheck}
                      title="No extracted rules yet"
                      description="Ingest a document on the Upload page — once processing finishes, its validated rules will show up here automatically."
                      className="border-none"
                    />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
