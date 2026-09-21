"use client";

import { useState } from "react";
import { Briefcase, Building2, FileText, Loader2, MapPin, Tag } from "lucide-react";
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
      <label htmlFor={htmlFor} className="flex items-center gap-1.5 text-xs font-medium text-[#171717]">
        {icon}
        <span>{label}</span>
      </label>
      {children}
      {hint && <p className="text-[11px] text-[#667085] font-normal">{hint}</p>}
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
      <DialogContent className="sm:max-w-xl rounded-xl border-zinc-200 bg-white p-5 sm:p-6 shadow-xl max-h-[90vh] overflow-y-auto">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <div className="flex items-center gap-2 mb-1">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[#171717] text-white">
                <Briefcase className="h-3.5 w-3.5" />
              </div>
              <DialogTitle className="text-base font-semibold text-[#171717]">
                {editing ? "Edit Position Details" : "Create Position"}
              </DialogTitle>
            </div>
            <DialogDescription className="text-xs text-[#667085]">
              Specify role details and requirements for candidate evaluation.
            </DialogDescription>
          </DialogHeader>

          {error && <ErrorBanner message={error} />}

          <Field label="Position Title" htmlFor="job-title">
            <Input
              id="job-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              placeholder="e.g. Lead Software Engineer"
              className="h-8 rounded-md border-[#E4E7EC] text-xs focus:border-[#171717] focus:ring-0"
              autoFocus
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Department" htmlFor="job-dept" icon={<Building2 className="h-3 w-3 text-[#98A2B3]" />}>
              <Input
                id="job-dept"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                maxLength={120}
                placeholder="Engineering"
                className="h-8 rounded-md border-[#E4E7EC] text-xs focus:border-[#171717] focus:ring-0"
              />
            </Field>
            <Field label="Location" htmlFor="job-loc" icon={<MapPin className="h-3 w-3 text-[#98A2B3]" />}>
              <Input
                id="job-loc"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                maxLength={120}
                placeholder="Remote / San Francisco"
                className="h-8 rounded-md border-[#E4E7EC] text-xs focus:border-[#171717] focus:ring-0"
              />
            </Field>
          </div>

          <Field
            label="Job Description"
            htmlFor="job-jd"
            icon={<FileText className="h-3 w-3 text-[#98A2B3]" />}
            hint="Role responsibilities and context used for semantic fit evaluation."
          >
            <Textarea
              id="job-jd"
              value={jd}
              onChange={(e) => setJd(e.target.value)}
              className="min-h-24 rounded-md border-[#E4E7EC] text-xs leading-relaxed focus:border-[#171717] focus:ring-0"
              maxLength={20000}
              placeholder="Outline responsibilities and core project requirements..."
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Must-Have Skills" htmlFor="job-must" icon={<Tag className="h-3 w-3 text-[#98A2B3]" />} hint="Comma separated">
              <Input
                id="job-must"
                value={must}
                onChange={(e) => setMust(e.target.value)}
                placeholder="Python, React, PostgreSQL"
                className="h-8 rounded-md border-[#E4E7EC] text-xs focus:border-[#171717] focus:ring-0"
              />
            </Field>
            <Field label="Preferred Skills" htmlFor="job-pref" icon={<Tag className="h-3 w-3 text-[#98A2B3]" />} hint="Comma separated">
              <Input
                id="job-pref"
                value={preferred}
                onChange={(e) => setPreferred(e.target.value)}
                placeholder="Docker, Redis, AWS"
                className="h-8 rounded-md border-[#E4E7EC] text-xs focus:border-[#171717] focus:ring-0"
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
              className="h-8 sm:max-w-36 rounded-md border-[#E4E7EC] text-xs focus:border-[#171717] focus:ring-0"
              placeholder="e.g. 4"
            />
          </Field>

          <DialogFooter className="pt-2 border-t border-[#E4E7EC] flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
              className="h-8 rounded-md border-[#E4E7EC] text-xs font-medium text-[#667085] hover:bg-[#F2F4F7]"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={saving}
              className="h-8 rounded-md bg-[#171717] text-xs font-medium text-white hover:bg-[#262626]"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" aria-hidden="true" />}
              {editing ? "Save Changes" : "Create Position"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
