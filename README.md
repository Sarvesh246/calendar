This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Push reminder dispatch

Closed-app reminders are delivered by `GET /api/push/dispatch`, which the
`Push dispatch` GitHub Actions workflow calls on a schedule.

Once push is configured on the deployment (`NEXT_PUBLIC_VAPID_PUBLIC_KEY`,
`VAPID_PRIVATE_KEY`, `NEXT_PUBLIC_SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` all present), the route refuses unauthenticated
calls so that nobody but the cron can trigger a send. Authentication is a
single shared value that has to exist in **both** places, set to the same
string:

| Where | What to set |
| --- | --- |
| Vercel project | environment variable `CRON_SECRET` (then redeploy) |
| GitHub repository | Actions secret `CRON_SECRET` (Settings → Secrets and variables → Actions) |

If either side is missing or the two disagree, the endpoint answers `401`,
every scheduled run fails, and no reminders go out. The workflow reports
that case as a named error rather than a bare curl exit code.
