"use client";

import { useState } from "react";
import { Briefcase, Building, FileText, Loader2, MapPin, Sparkles, Tag } from "lucide-react";
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

function Field({ label, hint, htmlFor, icon, children }: { label: string; hint?: string; htmlFor: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-zinc-700">
        {icon}
        {label}
      </label>
      {children}
      {hint && <p className="text-[11px] text-zinc-400 font-normal">{hint}</p>}
    </div>
  );
}

/** Create a job, or edit one when `job` is passed. */
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
    if (!title.trim()) return setError("Please provide a job title.");
    const years = minYears.trim() === "" ? null : Number(minYears);
    if (years !== null && (Number.isNaN(years) || years < 0 || years > 60)) {
      return setError("Minimum experience should be a number of years between 0 and 60.");
    }
    setSaving(true);
    setError(null);
    try {
      const body = {
        title: title.trim(),
        department: department.trim(),
        location: location.trim(),
        jd_text: jd.trim(),
        min_experience_years: years,
        must_have_skills: splitSkills(must),
        preferred_skills: splitSkills(preferred),
      };
      const saved = job ? await updateJob(job.id, body) : await createJob(body);
      toast("success", editing ? "Job updated successfully." : `Created position: ${saved.title}`);
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
      <DialogContent className="sm:max-w-2xl rounded-3xl border-zinc-200/80 p-6 sm:p-8">
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <div className="flex items-center gap-2.5 mb-1">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 border border-indigo-100 text-indigo-600">
                <Briefcase className="h-4 w-4" />
              </div>
              <DialogTitle className="text-xl font-bold text-zinc-900">
                {editing ? "Edit Position Details" : "Create New Job Requisition"}
              </DialogTitle>
            </div>
            <DialogDescription className="text-xs text-zinc-500">
              Specify responsibilities and requirements. Candidate resumes will be semantically matched against this criteria.
            </DialogDescription>
          </DialogHeader>

          {error && <ErrorBanner message={error} />}

          <Field label="Job Position Title" htmlFor="job-title" icon={<Briefcase className="h-3 w-3 text-indigo-500" />}>
            <Input
              id="job-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              placeholder="e.g. Staff AI Systems Engineer"
              className="rounded-xl border-zinc-200 focus:border-indigo-500 focus:ring-indigo-500/20"
              autoFocus
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Department" htmlFor="job-dept" icon={<Building className="h-3 w-3 text-zinc-400" />}>
              <Input
                id="job-dept"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                maxLength={120}
                placeholder="Core Platform / Engineering"
                className="rounded-xl border-zinc-200"
              />
            </Field>
            <Field label="Work Location" htmlFor="job-loc" icon={<MapPin className="h-3 w-3 text-zinc-400" />}>
              <Input
                id="job-loc"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                maxLength={120}
                placeholder="Bengaluru / Hybrid / Remote"
                className="rounded-xl border-zinc-200"
              />
            </Field>
          </div>

          <Field
            label="Job Description & Requirements"
            htmlFor="job-jd"
            icon={<FileText className="h-3 w-3 text-zinc-400" />}
            hint="Key responsibilities and qualifications used by AI for candidate scoring."
          >
            <Textarea
              id="job-jd"
              value={jd}
              onChange={(e) => setJd(e.target.value)}
              className="min-h-28 rounded-xl border-zinc-200 text-xs leading-relaxed"
              maxLength={20000}
              placeholder="Outline role objectives, day-to-day deliverables, and minimum criteria..."
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Must-Have Skills" htmlFor="job-must" icon={<Tag className="h-3 w-3 text-emerald-500" />} hint="Comma separated.">
              <Input
                id="job-must"
                value={must}
                onChange={(e) => setMust(e.target.value)}
                placeholder="Python, PyTorch, FastAPI, Docker"
                className="rounded-xl border-zinc-200"
              />
            </Field>
            <Field label="Preferred / Bonus Skills" htmlFor="job-pref" icon={<Sparkles className="h-3 w-3 text-violet-500" />} hint="Comma separated.">
              <Input
                id="job-pref"
                value={preferred}
                onChange={(e) => setPreferred(e.target.value)}
                placeholder="Kubernetes, LangChain, Kafka"
                className="rounded-xl border-zinc-200"
              />
            </Field>
          </div>

          <Field label="Minimum Experience (Years)" htmlFor="job-years">
            <Input
              id="job-years"
              type="number"
              inputMode="decimal"
              min={0}
              max={60}
              step="0.5"
              value={minYears}
              onChange={(e) => setMinYears(e.target.value)}
              className="sm:max-w-44 rounded-xl border-zinc-200"
              placeholder="e.g. 4"
            />
          </Field>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving} className="rounded-xl font-semibold">
              Cancel
            </Button>
            <Button
              type="submit"
              variant="brand"
              disabled={saving}
              className="rounded-xl font-semibold bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-600/20"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-1.5" aria-hidden="true" />}
              {editing ? "Save Job Changes" : "Publish Job Requisition"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
