import { getContext } from "@/lib/auth";
import { listCampaignOptions } from "@/services/debtors";
import { BackLink, Card, PageHeader } from "@/components/ui";
import { ImportForm } from "./ImportForm";
import { BookImporter } from "@/components/BookImporter";

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
        description="Upload the book in whatever format the client provided. Every row is validated and reported before anything is imported."
      />
      <div className="space-y-4">
        <Card title="Upload a file" subtitle="Jobix workbook, platform template, or any client spreadsheet">
          <BookImporter campaigns={campaigns} />
        </Card>
        <Card title="Paste CSV" subtitle="The platform template, pasted as text">
          <ImportForm campaigns={campaigns} />
        </Card>
      </div>
    </div>
  );
}
