# AIployee

Voice, messaging and workflow automation for South African property and finance
operations.

## Contents

| Path | What it is |
| --- | --- |
| [`docs/mafadi-automation-proposal.md`](docs/mafadi-automation-proposal.md) | Client-facing proposal for expanding Mafadi Property Management from collections into leasing and operations, across automation, voice, WhatsApp and dashboards |
| `docs/Mafadi_Automation_Proposal_28Jul2026.docx` | The same proposal as a Word document, ready to send and rebrand |
| [`docs/dashboard-data-model.md`](docs/dashboard-data-model.md) | Data model specification for the unified platform behind the dashboards |
| [`db/schema.sql`](db/schema.sql) | PostgreSQL DDL implementing that specification |
| [`db/smoke_test.sql`](db/smoke_test.sql) | Worked example per department, integrity assertions, and the headline metric queries |
| [`tools/md2docx.py`](tools/md2docx.py) | Markdown to Word converter used to build the proposal document |

## Running the schema locally

```bash
createdb aiployee_dev

# Supabase provides auth.uid(); stub it on plain PostgreSQL.
psql -d aiployee_dev -c "create schema if not exists auth;" \
  -c "create function auth.uid() returns uuid language sql stable as \$\$ select null::uuid \$\$;"

psql -v ON_ERROR_STOP=1 -d aiployee_dev -f db/schema.sql -f db/smoke_test.sql
```

The smoke test runs inside a transaction and rolls back, so it leaves no data
behind.

## Regenerating the proposal document

The `.docx` is generated from the markdown source, which stays the single point
of truth:

```bash
pip install python-docx
python3 tools/md2docx.py docs/mafadi-automation-proposal.md \
    docs/Mafadi_Automation_Proposal_28Jul2026.docx
```
