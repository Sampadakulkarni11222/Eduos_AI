# Finance & Billing Operations

Run the billing worker once daily from a single scheduler instance:

```bash
npm run jobs:billing
```

The job sends in-app reminders for unpaid invoices due within seven days or already overdue. On the first day of each calendar quarter it sends the completed quarter's financial summary to active School Admin profiles. Both paths have database uniqueness keys, so retries and overlapping job starts do not duplicate a delivery.

## Cost ledger

Finance can record a school cost through `POST /api/v1/expenses`; Finance and Admin can read `GET /api/v1/expenses` and `GET /api/v1/expenses/summary`. Every cost is tenant-scoped and audited. Quarterly reports include collected fees, recorded costs, net position, outstanding fees and overdue leakage risk.

Only deploy the worker with the same production environment variables and MongoDB connection as the API. Do not run it in every web-server instance.
# WhatsApp delivery (optional)

The ERP always creates secure in-app reminder/report notifications. To also send a business-initiated WhatsApp message, Meta requires a guardian/admin opt-in and an approved template; ordinary text cannot be sent outside the 24-hour WhatsApp service window.

After the templates are approved in Meta Business Manager, configure these production-only environment variables (never commit values):

```env
WA_BILLING_NOTIFICATIONS_ENABLED=true
WA_BILLING_REMINDER_TEMPLATE=your_approved_reminder_template
WA_QUARTERLY_REPORT_TEMPLATE=your_approved_quarterly_template
WA_TEMPLATE_LANGUAGE=en
```

Reminder template body variables, in order: invoice number, outstanding amount, due date, status. Quarterly template body variables: quarter, collection rate, collected, costs, net position, outstanding, overdue. Keep the template variable count/order identical.

# Production scheduler

Run `npm --prefix backend run jobs:billing` once daily from the hosting platform's scheduler using the same production environment variables as the API. The job is idempotent: it records one reminder per invoice/recipient/day and one quarterly report per administrator/quarter, so retries are safe.

Example cron expression: `15 8 * * *` (08:15 daily in the server's configured school timezone). Set `SCHOOL_TIMEZONE=Asia/Kolkata` when the school operates in India.

