"use client";

import { useState } from "react";
import { PageShell } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { apiV1 } from "@/config/api";
import { api } from "@/lib/api";

export default function AssistantPage() {
  const [input, setInput] = useState("Show today entries");
  const [reply, setReply] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function send() {
    setLoading(true);
    setReply(null);
    try {
      const res = await api<{ reply: string }>(apiV1("/assistant/query"), {
        method: "POST",
        body: JSON.stringify({ message: input }),
      });
      setReply(res.reply);
    } catch (e) {
      setReply(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <PageShell title="AI assistant">
      <div className="mx-auto max-w-3xl space-y-4">
        <Card>
          <CardContent className="space-y-4 pt-6">
            <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask in natural language…" />
            <Button onClick={send} disabled={loading}>
              {loading ? "Thinking…" : "Ask"}
            </Button>
            {reply && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm leading-relaxed text-slate-800 whitespace-pre-wrap">
                {reply}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
