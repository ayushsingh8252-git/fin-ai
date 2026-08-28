import ProductGate from "@/components/auth/ProductGate";
import { ProductNav } from "@/components/layout/ProductNav";

/** Route group — doesn't affect URLs (still /rag, /screening-agent, etc.) but
 * gates every product page behind Google sign-in in one place, and renders
 * the shared product nav once instead of each page duplicating it. ProductNav
 * must render inside ProductGate so it hides behind the sign-in wall if
 * AUTH_GATE_ENABLED is ever switched on. ProductNav self-hides on /rag,
 * which keeps its own bespoke nav (out of scope for this pass). */
export default function ProductsLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProductGate>
      <ProductNav />
      {children}
    </ProductGate>
  );
}
