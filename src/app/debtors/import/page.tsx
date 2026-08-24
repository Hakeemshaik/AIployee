import { getContext } from "@/lib/auth";
import { listCampaignOptions } from "@/services/debtors";
import { BackLink, GlassCard, PageHeader } from "@/components/ui";
import { ImportForm } from "./ImportForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Import debtors" };

export default async function ImportDebtorsPage() {
  const ctx = await getContext();
  const campaigns = await listCampaignOptions(ctx.organizationId);

  return (
    <div className="page-in mx-auto max-w-3xl">
      <BackLink href="/debtors" label="All debtors" />
      <PageHeader
        title="Import debtors"
        description="Upload a CSV of accounts. Rows are validated individually — valid rows import, problems are reported per row."
      />
      <GlassCard>
        <ImportForm campaigns={campaigns} />
      </GlassCard>
    </div>
  );
}
