import { RecruitmentShell } from "./_components/RecruitmentShell";

/** Inherits sign-in gating and the product nav from (products)/layout.tsx;
 * adds the recruitment frame (role/permissions, toasts, section header). */
export default function RecruitmentLayout({ children }: { children: React.ReactNode }) {
  return <RecruitmentShell>{children}</RecruitmentShell>;
}
