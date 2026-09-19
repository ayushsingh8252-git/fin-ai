"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { createJob, errorMessage, updateJob, type Job } from "@/lib/recruitmentApi";

const splitSkills = (text: string): string[] =>
  Array.from(new Set(text.split(/[,\n]/).map((s) => s.trim()).filter(Boolean)));

function Field({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="text-xs font-semibold text-zinc-700">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

/** Create a job, or edit one when `job` is passed. The form is remounted each
 * time it opens (the parent keys it), so it always starts from the job's
 * current saved values rather than whatever was left in it last time. */
export function JobFormDialog({
  open, onOpenChange, job, onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job?: Job;
  onSaved: (job: Job) => void;
}) {
  const { toast } = useToast();
  const editing = Boolean(job);
  const [title, setTitle] = useState(job?.title ?? "");
  const [department, setDepartment] = useState(job?.department ?? "");
  const [location, setLocation] = useState(job?.location ?? "");
  const [jd, setJd] = useState(job?.jd_text ?? "");
  const [must, setMust] = useState((job?.must_have_skills ?? []).join(", "));
  const [preferred, setPreferred] = useState((job?.preferred_skills ?? []).join(", "));
  const [minYears, setMinYears] = useState(job?.min_experience_years != null ? String(job.min_experience_years) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return setError("Give the job a title.");
    const years = minYears.trim() === "" ? null : Number(minYears);
    if (years !== null && (Number.isNaN(years) || years < 0 || years > 60)) {
      return setError("Minimum experience should be a number of years between 0 and 60.");
    }
    setSaving(true);
    setError(null);
    try {
      const body = {
        title: title.trim(),
        // Always sent (even when empty) so that clearing a field while editing
        // really clears it; an omitted key would be ignored by the server.
        department: department.trim(),
        location: location.trim(),
        jd_text: jd.trim(),
        min_experience_years: years,
        must_have_skills: splitSkills(must),
        preferred_skills: splitSkills(preferred),
      };
      const saved = job ? await updateJob(job.id, body) : await createJob(body);
      // Only now is it true, so only now do we say so.
      toast("success", editing ? "Job updated." : `Created ${saved.title}.`);
      onSaved(saved);
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit job" : "New job"}</DialogTitle>
            <DialogDescription>
              Candidates are matched against this description and these skills, so the more specific it is, the more useful the match.
            </DialogDescription>
          </DialogHeader>

          {error && <ErrorBanner message={error} />}

          <Field label="Job title" htmlFor="job-title">
            <Input id="job-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="e.g. AI/ML Engineer" autoFocus />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Department" htmlFor="job-dept">
              <Input id="job-dept" value={department} onChange={(e) => setDepartment(e.target.value)} maxLength={120} placeholder="Engineering" />
            </Field>
            <Field label="Location" htmlFor="job-loc">
              <Input id="job-loc" value={location} onChange={(e) => setLocation(e.target.value)} maxLength={120} placeholder="Bengaluru / Remote" />
            </Field>
          </div>
          <Field label="Job description" htmlFor="job-jd" hint="Responsibilities and requirements. This is what resumes are matched against.">
            <Textarea id="job-jd" value={jd} onChange={(e) => setJd(e.target.value)} className="min-h-32" maxLength={20000} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Must-have skills" htmlFor="job-must" hint="Separate with commas.">
              <Input id="job-must" value={must} onChange={(e) => setMust(e.target.value)} placeholder="Python, FastAPI, AWS" />
            </Field>
            <Field label="Nice-to-have skills" htmlFor="job-pref" hint="Separate with commas.">
              <Input id="job-pref" value={preferred} onChange={(e) => setPreferred(e.target.value)} placeholder="Docker, Terraform" />
            </Field>
          </div>
          <Field label="Minimum experience (years)" htmlFor="job-years">
            <Input id="job-years" type="number" inputMode="decimal" min={0} max={60} step="0.5" value={minYears} onChange={(e) => setMinYears(e.target.value)} className="sm:max-w-40" />
          </Field>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" variant="brand" disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {editing ? "Save changes" : "Create job"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
